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

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  leaseSpy.mockClear();
  document.body.innerHTML = "";
});

describe("AudioWaveform", () => {
  it("paints a baseline and peak bar for every mapped waveform bin", () => {
    const fillRect = vi.fn();
    const context = {
      scale: vi.fn(),
      clearRect: vi.fn(),
      fillRect,
      fillStyle: "",
    } as unknown as CanvasRenderingContext2D;
    const canvas = document.createElement("canvas");
    Object.defineProperties(canvas, {
      clientWidth: { value: 6 },
      clientHeight: { value: 20 },
    });
    vi.spyOn(canvas, "getContext").mockReturnValue(context);
    drawWaveformCanvas(canvas, [0.25, 1], false, 0, 1);
    expect(fillRect).toHaveBeenCalledTimes(4);
    expect(fillRect.mock.calls.map(([x, y, width, height]) => [x, y, width, height])).toEqual([
      [0, 18, 3, 2],
      [0, 15, 3, 5],
      [3, 18, 3, 2],
      [3, 0, 3, 20],
    ]);
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

  it("greys the clip in place when muted and draws the parent tick when linked", () => {
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
          linked
        />,
      );
    });

    expect(host.getAttribute("data-audio-muted")).toBe("true");
    expect(host.querySelector(".timeline-audio-link")).not.toBeNull();

    act(() => root.unmount());
    expect(host.hasAttribute("data-audio-muted")).toBe(false);
  });
});
