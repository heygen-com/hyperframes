// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
const { leaseSpy } = vi.hoisted(() => ({
  leaseSpy: vi.fn((_request: unknown) => ({ status: "loading" as const })),
}));

vi.mock("../../hooks/useThumbnailLease", () => ({
  useThumbnailLease: leaseSpy,
}));

import { AudioWaveform, drawWaveformCanvas } from "./AudioWaveform";
import { markTimelineMotion } from "./timelineMotion";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<ReturnType<typeof createRoot>> = [];

afterEach(() => {
  act(() => mounted.splice(0).forEach((root) => root.unmount()));
  vi.restoreAllMocks();
  vi.useRealTimers();
  leaseSpy.mockReset();
  leaseSpy.mockImplementation(() => ({ status: "loading" as const }));
  document.body.innerHTML = "";
});

/** Renders a ready waveform for a two-peak sound into `parent`. */
function renderReadyWaveform(parent: HTMLElement = document.body) {
  leaseSpy.mockImplementation(
    () => ({ status: "ready", value: { kind: "waveform", peaks: [0.5, 1] } }) as never,
  );
  const host = document.createElement("div");
  parent.append(host);
  const root = createRoot(host);
  mounted.push(root);
  act(() => {
    root.render(
      <AudioWaveform
        audioUrl="/media/voice.wav"
        label=""
        labelColor="#fff"
        projectId="project-a"
        sessionEpoch={1}
        priority="visible"
      />,
    );
  });
}

/** A 6 x 20 canvas whose 2D context records every fill as [style, x, y, width, height]. */
function recordingCanvas() {
  const fills: Array<[string, number, number, number, number]> = [];
  const context = {
    scale: vi.fn(),
    clearRect: vi.fn(),
    fillStyle: "",
    fillRect: (x: number, y: number, width: number, height: number) =>
      fills.push([String(context.fillStyle), x, y, width, height]),
  } as unknown as CanvasRenderingContext2D;
  const canvas = document.createElement("canvas");
  Object.defineProperties(canvas, {
    clientWidth: { value: 6 },
    clientHeight: { value: 20 },
  });
  vi.spyOn(canvas, "getContext").mockReturnValue(context);
  return { canvas, fills };
}

describe("AudioWaveform", () => {
  it("paints a baseline and peak bar for every mapped waveform bin", () => {
    const { canvas, fills } = recordingCanvas();
    drawWaveformCanvas(canvas, [0.25, 1], false, 0, 1);
    expect(fills.map(([, x, y, width, height]) => [x, y, width, height])).toEqual([
      [0, 18, 3, 2],
      [0, 15, 3, 5],
      [3, 18, 3, 2],
      [3, 0, 3, 20],
    ]);
  });

  it("draws only the span of the clip it is given", () => {
    const { canvas, fills } = recordingCanvas();
    // The clip's second half holds the loud peak only.
    drawWaveformCanvas(canvas, [0.25, 1], false, 0, 1, null, { from: 0.5, to: 1 });
    const bars = fills.filter(([, , y, , height]) => !(y === 18 && height === 2));
    expect(bars.map(([, , y, , height]) => [y, height])).toEqual([
      [0, 20],
      [0, 20],
    ]);
  });

  it("redraws when the timeline comes to rest, not at each zoom step", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    renderReadyWaveform();
    const drawn = getContext.mock.calls.length;
    expect(drawn).toBeGreaterThan(0);
    act(() => markTimelineMotion());
    expect(getContext.mock.calls.length).toBe(drawn);
    act(() => vi.runOnlyPendingTimers());
    expect(getContext.mock.calls.length).toBe(drawn + 1);
  });

  it("redraws on scroll only once the view leaves the drawn stretch, as playback follows", () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const scroller = document.createElement("div");
    scroller.setAttribute("data-timeline-scroll-viewport", "");
    document.body.append(scroller);
    // A 10000px clip in a 1000px view; the clip's left edge moves as the view scrolls.
    let clipLeft = 0;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        return (
          this === scroller
            ? { left: 0, right: 1000, width: 1000 }
            : { left: clipLeft, right: clipLeft + 10_000, width: 10_000 }
        ) as DOMRect;
      },
    );
    renderReadyWaveform(scroller);
    const drawn = getContext.mock.calls.length;
    const scrollTo = (left: number) => {
      clipLeft = -left;
      act(() => scroller.dispatchEvent(new Event("scroll")));
    };
    // Drawn to 2000px, one view past the screen: 500..1500 is still drawn.
    scrollTo(500);
    expect(getContext.mock.calls.length).toBe(drawn);
    scrollTo(1500);
    expect(getContext.mock.calls.length).toBe(drawn + 1);
  });

  it("shrinks each bar to the fade's gain and keeps the cut-away part as a ghost", () => {
    const { canvas, fills } = recordingCanvas();
    // A 1 s fade-in on a 2 s clip: the first bar's centre (0.5 s) plays at half gain.
    drawWaveformCanvas(canvas, [1, 1], false, 0, 1, { fadeIn: 1, fadeOut: 0, duration: 2 });
    const bars = fills.filter(([, , y, , height]) => !(y === 18 && height === 2));
    // The heard half, then the ghost only above it, so the two never stack.
    expect(bars.map(([, x, y, width, height]) => [x, y, width, height])).toEqual([
      [0, 10, 3, 10],
      [0, 0, 3, 10],
      [3, 0, 3, 20],
    ]);
    const alpha = (style: string) => Number(style.split(",").at(-1)?.replace(")", ""));
    expect(alpha(bars[1][0])).toBeCloseTo(alpha(bars[0][0]) * 0.27, 2);
  });

  it("leases waveform decoding with the clip's project, session, and viewport priority", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    act(() => {
      root.render(
        <AudioWaveform
          audioUrl="/media/voice.wav"
          label=""
          labelColor="#fff"
          projectId="project-a"
          sessionEpoch={9}
          priority="interaction"
        />,
      );
    });

    expect(leaseSpy).toHaveBeenCalled();
    expect(leaseSpy.mock.calls.at(-1)?.[0]).toMatchObject({
      projectId: "project-a",
      sessionEpoch: 9,
      kind: "waveform",
      priority: "interaction",
      rich: false,
    });

    act(() => root.unmount());
  });

  it("greys the clip in place when muted", () => {
    const host = document.createElement("div");
    host.className = "timeline-clip is-audio";
    document.body.append(host);
    const root = createRoot(host);

    act(() => {
      root.render(
        <AudioWaveform
          audioUrl="/media/voice.wav"
          label=""
          labelColor="#fff"
          projectId="project-a"
          sessionEpoch={1}
          priority="visible"
          muted
        />,
      );
    });

    expect(host.getAttribute("data-audio-muted")).toBe("true");

    act(() => root.unmount());
    expect(host.hasAttribute("data-audio-muted")).toBe(false);
  });

  it("fills a short sound strip when the label band is dropped", () => {
    const heights = [16, 0].map((labelInset) => {
      const host = document.createElement("div");
      document.body.append(host);
      const root = createRoot(host);
      act(() => {
        root.render(
          <AudioWaveform
            audioUrl="/media/talk.mp4"
            label=""
            labelColor="#fff"
            projectId="project-a"
            sessionEpoch={1}
            priority="visible"
            {...(labelInset === 16 ? {} : { labelInset })}
          />,
        );
      });
      const canvas = host.querySelector("canvas");
      const box = { top: canvas?.style.top, height: canvas?.style.height };
      act(() => root.unmount());
      return box;
    });
    expect(heights).toEqual([
      { top: "16px", height: "calc(100% - 16px)" },
      { top: "0px", height: "calc(100% - 0px)" },
    ]);
  });
});
