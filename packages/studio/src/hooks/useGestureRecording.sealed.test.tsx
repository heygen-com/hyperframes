// @vitest-environment jsdom

import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountReactHarness } from "./domSelectionTestHarness";
import { useGestureRecording, type GestureSample } from "./useGestureRecording";
import { usePlayerStore } from "../player/store/playerStore";
import type { EditingGestureBase } from "@hyperframes/core/runtime/editing-port";

const frame = vi.hoisted(() => ({
  sealed: true,
  stage: null as { width: number; height: number } | null,
}));
vi.mock("../player/lib/previewChannel", async (load) => ({
  ...(await load<typeof import("../player/lib/previewChannel")>()),
  previewFrameOpaque: () => frame.sealed,
}));
const drafts = vi.hoisted(() => ({ draw: vi.fn(), end: vi.fn() }));
vi.mock("../components/editor/previewDrafts", () => ({
  drawPreviewDraft: drafts.draw,
  endPreviewDraft: drafts.end,
}));
vi.mock("../player/lib/bridgePlayback", async (load) => ({
  ...(await load<typeof import("../player/lib/bridgePlayback")>()),
  previewStageSize: () => frame.stage,
}));

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

let ticks: FrameRequestCallback[] = [];
let nowMs = 0;

beforeEach(() => {
  ticks = [];
  nowMs = 0;
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((tick: FrameRequestCallback) => ticks.push(tick)),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(performance, "now").mockImplementation(() => nowMs);
  frame.sealed = true;
  drafts.draw.mockClear();
  drafts.end.mockClear();
  usePlayerStore.setState({ currentTime: 0, duration: 10, requestedSeekTime: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const AT_REST: EditingGestureBase = { x: 0, y: 0, opacity: 1, scale: 1 };

/** Starts recording on a frame drawn 960 px wide; a sealed one starts from `base`, as the frame answered it. */
function startOn(
  base: EditingGestureBase | null,
  elementEnd?: number,
  liveGsap?: Record<string, number>,
  emptyTimeline = false,
) {
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  if (liveGsap)
    Object.assign(iframe.contentWindow!, {
      gsap: { getProperty: (_element: Element, prop: string) => liveGsap[prop], set: vi.fn() },
      ...(emptyTimeline && {
        __timelines: { main: { duration: () => 0, seek: vi.fn() } },
        __player: { getTime: () => usePlayerStore.getState().currentTime },
      }),
    });
  vi.spyOn(iframe, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 960, 540));
  const standIn = document.createElement("div");
  standIn.id = "card";
  let recording: ReturnType<typeof useGestureRecording> | null = null;
  function Harness() {
    recording = useGestureRecording();
    return null;
  }
  const root = mountReactHarness(<Harness />);
  let started: boolean | undefined;
  act(() => {
    started = recording?.startRecording(standIn, iframe, elementEnd, base);
  });
  const tick = (ms: number) => {
    nowMs = ms;
    act(() => ticks.shift()?.(ms));
  };
  const stop = () => {
    let samples: GestureSample[] = [];
    act(() => {
      samples = recording?.stopRecording() ?? [];
    });
    act(() => root.unmount());
    return samples;
  };
  return { iframe, started, tick, stop };
}

/** Records a pointer move of `dx` screen px. */
function recordOnSealedFrame(dx: number, base: EditingGestureBase | null, elementEnd?: number) {
  const { started, tick, stop } = startOn(base, elementEnd);
  const move = (clientX: number, ms: number) => {
    document.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX }));
    tick(ms);
  };
  move(0, 0);
  move(dx, 300);
  const seekAfterMove = usePlayerStore.getState().requestedSeekTime;
  move(dx, 900);
  const samples = stop();
  return { started, samples, seekAfterMove, last: samples.at(-1)?.properties };
}

describe("a gesture recording on a sealed preview", () => {
  // fails without the fix: the recorder read GSAP and the film size through the frame's window, which a sealed
  // frame doesn't expose, so it recorded from 0/0 on a 1920-wide film and saved keyframes that dropped the offset.
  it("starts from the layer's GSAP offset the frame reported", () => {
    frame.stage = { width: 1920, height: 1080 };
    expect(recordOnSealedFrame(100, { ...AT_REST, x: 240, y: 80 }).last).toEqual({ x: 440, y: 80 });
  });

  // fails without the fix: the frame's layer stood still while recording, since only an unsealed frame's GSAP moved it.
  it("draws the layer moving live on the frame, and puts it back when the recording stops", () => {
    frame.stage = { width: 1920, height: 1080 };
    recordOnSealedFrame(100, { ...AT_REST, x: 240, y: 80 });
    const [standIn, last] = drafts.draw.mock.lastCall!;
    expect(last).toEqual({ translate: { x: 200, y: 0 } });
    expect(drafts.end.mock.calls).toEqual([[standIn, "restore"]]);
  });

  // fails without the fix: the frame drew only the move, so a recorded scale, opacity or turn stood still.
  it("has a frame that can set every recorded value set them at the recording's time, and clear them on stop", () => {
    frame.stage = { width: 1920, height: 1080 };
    usePlayerStore.setState({ currentTime: 2 });
    recordOnSealedFrame(100, { ...AT_REST, x: 240, y: 80, drawsProps: true }, 2.5);
    const [standIn, last] = drafts.draw.mock.lastCall!;
    expect(last).toEqual({ translate: null, props: { seconds: 2.5, values: { x: 440, y: 80 } } });
    expect(usePlayerStore.getState().currentTime).toBe(2.5);
    expect(drafts.end.mock.calls).toEqual([[standIn, "clear"]]);
  });

  it("draws nothing over the channel for an unsealed frame, whose GSAP moves the layer", () => {
    frame.sealed = false;
    frame.stage = { width: 1920, height: 1080 };
    recordOnSealedFrame(100, null);
    expect([drafts.draw.mock.calls, drafts.end.mock.calls]).toEqual([[], []]);
  });

  it("scales the pointer by the film's own width, not 1920", () => {
    frame.stage = { width: 1080, height: 1920 };
    expect(recordOnSealedFrame(100, AT_REST).last).toEqual({ x: 113, y: 0 });
  });

  it("moves the film's playhead with the recording, up to the layer's end, so auto-stop can fire", () => {
    frame.stage = { width: 1920, height: 1080 };
    usePlayerStore.setState({ currentTime: 2 });
    const { seekAfterMove, samples } = recordOnSealedFrame(100, AT_REST, 2.5);
    expect(seekAfterMove).toBeCloseTo(2.3);
    expect(usePlayerStore.getState().requestedSeekTime).toBe(2.5);
    expect(samples.at(-1)?.time).toBe(0.5);
  });

  it("saves no sample past a layer end that falls between frames", () => {
    frame.stage = { width: 1920, height: 1080 };
    usePlayerStore.setState({ currentTime: 2 });
    const { samples } = recordOnSealedFrame(100, AT_REST, 2.52);
    expect(usePlayerStore.getState().requestedSeekTime).toBe(2.52);
    expect(samples.at(-1)?.time).toBe(0.5);
  });

  it("refuses to record when the frame hasn't reported the layer's values", () => {
    frame.stage = { width: 1920, height: 1080 };
    const { started, samples } = recordOnSealedFrame(100, null);
    expect([started, samples]).toEqual([false, []]);
  });

  it("refuses to record when the frame hasn't reported the film's size", () => {
    frame.stage = null;
    const { started, samples } = recordOnSealedFrame(100, AT_REST);
    expect([started, samples]).toEqual([false, []]);
  });

  it("scales from a static scale the same sealed as unsealed", () => {
    const scaledBy = (sealed: boolean) => {
      ticks = [];
      frame.sealed = sealed;
      frame.stage = { width: 1920, height: 1080 };
      const { tick, stop } = startOn(
        { x: 0, y: 0, opacity: 0.5, scale: 1.5 },
        undefined,
        sealed ? undefined : { x: 0, y: 0, opacity: 0.5, scaleX: 1.5 },
      );
      document.dispatchEvent(new WheelEvent("wheel", { deltaY: 10, metaKey: true }));
      tick(100);
      return stop().at(-1)?.properties.scale;
    };
    expect([scaledBy(false), scaledBy(true)]).toEqual([1.6, 1.6]);
  });
});

describe("a recording on a film whose own timeline is empty", () => {
  const AT_REST_GSAP = { x: 0, y: 0, opacity: 1, scaleX: 1 };
  const recordMove = (sealed: boolean) => {
    ticks = [];
    nowMs = 0;
    frame.sealed = sealed;
    frame.stage = { width: 1920, height: 1080 };
    usePlayerStore.setState({ currentTime: 2, duration: 10, requestedSeekTime: null });
    const { tick, stop } = startOn(sealed ? AT_REST : null, 2.5, AT_REST_GSAP, !sealed);
    const move = (clientX: number, ms: number) => {
      document.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX }));
      tick(ms);
    };
    move(0, 0);
    move(100, 300);
    move(100, 900);
    return stop().map(({ time, properties }) => ({ time, properties }));
  };

  // fails without the fix: unsealed capped the recording at its timeline's own length, 0 here, so every sample
  // landed at 0 s, the playhead never moved and the recording saved nothing.
  it("records over time unsealed, up to the layer's end within the film", () => {
    const samples = recordMove(false);
    expect(samples.at(-1)?.time).toBe(0.5);
    expect(usePlayerStore.getState().currentTime).toBe(2.5);
  });

  it("records the same samples sealed and unsealed", () => {
    expect(recordMove(false)).toEqual(recordMove(true));
  });
});
