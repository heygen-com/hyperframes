// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
const { leaseSpy } = vi.hoisted(() => ({
  leaseSpy: vi.fn(
    (
      _request: unknown,
    ):
      | { status: "loading" }
      | { status: "ready"; value: { kind: "waveform"; peaks: number[] } } => ({
      status: "loading",
    }),
  ),
}));

vi.mock("../../hooks/useThumbnailLease", () => ({
  useThumbnailLease: leaseSpy,
}));

import { AudioWaveform, drawWaveformCanvas } from "./AudioWaveform";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  leaseSpy.mockReset();
  leaseSpy.mockReturnValue({ status: "loading" });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

/** A 6 x 20 canvas whose 2D context records every fill as [style, x, y, width, height]. */
function recordingCanvas(width = 6) {
  const fills: Array<[string, number, number, number, number]> = [];
  let offsetX = 0;
  const context = {
    scale: vi.fn(),
    clearRect: vi.fn(),
    translate: (x: number) => {
      offsetX += x;
    },
    fillStyle: "",
    fillRect: (x: number, y: number, width: number, height: number) =>
      fills.push([String(context.fillStyle), x + offsetX, y, width, height]),
  } as unknown as CanvasRenderingContext2D;
  const canvas = document.createElement("canvas");
  Object.defineProperties(canvas, {
    clientWidth: { value: width },
    clientHeight: { value: 20 },
  });
  vi.spyOn(canvas, "getContext").mockReturnValue(context);
  return { canvas, fills };
}

describe("AudioWaveform", () => {
  it("bounds a long clip's bitmap and bars to its visible window", () => {
    const { canvas, fills } = recordingCanvas(15000);
    drawWaveformCanvas(canvas, [0.25, 1], false, 0, 1, null, {
      fullWidth: 15000,
      left: 9000,
      width: 900,
    });
    expect(canvas.width).toBe(900 * (window.devicePixelRatio || 1));
    expect(fills).toHaveLength(600);
    expect(fills[0]?.slice(1)).toEqual([0, 18, 3, 2]);
    expect(fills.at(-1)?.[1]).toBe(897);
  });

  it("keeps the full clip's trimmed bins and fade centres in a partial window", () => {
    const { canvas: fullCanvas, fills: fullFills } = recordingCanvas(12);
    const { canvas: windowCanvas, fills: windowFills } = recordingCanvas(12);
    const peaks = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
    const fades = { fadeIn: 2, fadeOut: 2, duration: 4 };
    drawWaveformCanvas(fullCanvas, peaks, false, 0.25, 0.75, fades);
    drawWaveformCanvas(windowCanvas, peaks, false, 0.25, 0.75, fades, {
      fullWidth: 12,
      left: 3,
      width: 6,
    });
    const expected = fullFills
      .filter(([, x]) => x >= 3 && x < 9)
      .map(([style, x, y, width, height]) => [style, x - 3, y, width, height]);
    expect(windowFills).toEqual(expected);
  });

  it("releases the bitmap and paints no bars outside the viewport", () => {
    const { canvas, fills } = recordingCanvas(15000);
    drawWaveformCanvas(canvas, [1], false, 0, 1, null, {
      fullWidth: 15000,
      left: 15000,
      width: 0,
    });
    expect(canvas.width).toBe(0);
    expect(fills).toEqual([]);
  });

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

  it("updates the bitmap height when the same clip drops its label band", () => {
    const observers: TestResizeObserver[] = [];
    class TestResizeObserver implements ResizeObserver {
      readonly targets = new Set<Element>();
      constructor(private readonly callback: ResizeObserverCallback) {
        observers.push(this);
      }
      observe(target: Element) {
        this.targets.add(target);
      }
      unobserve(target: Element) {
        this.targets.delete(target);
      }
      disconnect() {
        this.targets.clear();
      }
      notify(target: Element) {
        this.callback(
          [
            {
              target,
              contentRect: new DOMRect(),
              borderBoxSize: [],
              contentBoxSize: [],
              devicePixelContentBoxSize: [],
            },
          ],
          this,
        );
      }
    }
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const { canvas: recorded } = recordingCanvas();
    const context = recorded.getContext("2d");
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
    vi.spyOn(HTMLCanvasElement.prototype, "clientHeight", "get").mockImplementation(
      function (this: HTMLCanvasElement) {
        return 64 - Number.parseFloat(this.style.top || "0");
      },
    );
    leaseSpy.mockReturnValue({ status: "ready", value: { kind: "waveform", peaks: [0.25, 1] } });
    const host = document.createElement("div");
    host.style.height = "64px";
    document.body.append(host);
    const root = createRoot(host);
    const waveform = (labelInset: number) => (
      <AudioWaveform
        audioUrl="/media/talk.mp4"
        label=""
        labelColor="#fff"
        projectId="project-a"
        sessionEpoch={1}
        priority="visible"
        labelInset={labelInset}
      />
    );
    act(() => root.render(waveform(16)));
    const canvas = host.querySelector("canvas");
    expect(canvas?.height).toBe(Math.ceil(48 * (window.devicePixelRatio || 1)));
    act(() => root.render(waveform(0)));
    expect(host.querySelector("canvas")).toBe(canvas);
    if (!canvas) throw new Error("Waveform canvas missing");
    act(() => {
      observers.find((observer) => observer.targets.has(canvas))?.notify(canvas);
      frames.splice(0).forEach((callback) => callback(0));
    });
    expect(canvas.height).toBe(Math.ceil(64 * (window.devicePixelRatio || 1)));
    expect(host.style.height).toBe("64px");
    act(() => root.unmount());
  });
});
