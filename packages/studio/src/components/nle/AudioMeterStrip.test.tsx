// @vitest-environment happy-dom
// fallow-ignore-file code-duplication

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "../../player/store/playerStore";
import type { TimelineElement } from "../../player/store/timelineElement";
import { useAudioMetersVisible } from "../../utils/audioMeterVisibility";
import { fractionToLevel, levelToFraction } from "../../utils/audioMeterMath";
import { AudioMeterStrip } from "./AudioMeterStrip";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const iframe = { contentWindow: null as unknown };
const previewIframeRef = { current: iframe };
vi.mock("../../contexts/StudioContext", () => ({
  useStudioShellContext: () => ({ previewIframeRef }),
}));

const onSetAudioGroupAttributeLive = vi.fn();
const onSetAudioGroupAttributeQuiet = vi.fn();
vi.mock("../../contexts/TimelineEditContext", () => ({
  useTimelineEditContextOptional: () => ({
    onSetAudioGroupAttributeLive,
    onSetAudioGroupAttributeQuiet,
  }),
}));

function stubTrackRect(): () => void {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (): DOMRect {
    return {
      left: 0,
      top: 0,
      right: 8,
      bottom: 100,
      width: 8,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
  };
  return () => {
    Element.prototype.getBoundingClientRect = original;
  };
}

const makeHook = (groups: Record<string, { l: number; r: number }> = {}) => ({
  start: vi.fn(),
  stop: vi.fn(),
  read: vi.fn(() => ({ master: { l: 1, r: 0.5 }, groups })),
});
const setHook = (hook: ReturnType<typeof makeHook> | null) => {
  iframe.contentWindow = hook ? { __hf: { audioMeter: hook } } : null;
};
const clip = (extra: Partial<TimelineElement>) =>
  ({ id: "a", tag: "audio", ...extra }) as TimelineElement;

let frames: FrameRequestCallback[] = [];
const tick = () => {
  const run = frames;
  frames = [];
  act(() => run.forEach((cb) => cb(performance.now() + 16)));
};

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  usePlayerStore.setState({ elements: [], audioVolume: 1 });
  useAudioMetersVisible.setState({ visible: true });
  onSetAudioGroupAttributeLive.mockClear();
  onSetAudioGroupAttributeQuiet.mockClear();
});
const roots: Root[] = [];
afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<AudioMeterStrip />));
  roots.push(root);
  return { host, root };
}

describe("AudioMeterStrip", () => {
  it("is absent when the project has no audio", () => {
    usePlayerStore.setState({ elements: [clip({ tag: "div" })] });
    expect(mount().host.querySelector("[data-testid=audio-meter-strip]")).toBeNull();
  });

  it("shows one strip per group plus Master, and hides when toggled off", () => {
    usePlayerStore.setState({
      elements: [
        clip({ id: "1", audioGroup: "music", audioGroupLabel: "Music" }),
        clip({ id: "2", audioGroup: "vo" }),
      ],
    });
    const { host } = mount();
    expect(host.textContent).toContain("Music");
    expect(host.textContent).toContain("vo");
    expect(host.textContent).toContain("Master");
    act(() => useAudioMetersVisible.getState().setVisible(false));
    expect(host.querySelector("[data-testid=audio-meter-strip]")).toBeNull();
  });

  it("starts the taps once, drives the bars, follows a swapped preview window, and stops on unmount", () => {
    usePlayerStore.setState({ elements: [clip({ audioGroup: "vo" })] });
    const first = makeHook({ vo: { l: 1, r: 1 } });
    setHook(first);
    const { host, root } = mount();
    const mask = host.querySelector<HTMLElement>("[data-testid=meter-mask]")!;
    expect(mask.style.height).toBe("100%");
    tick();
    tick();
    expect(first.start).toHaveBeenCalledTimes(1);
    expect(mask.style.height).toBe("0%");
    const peak = host.querySelector<HTMLElement>("[data-testid=meter-peak]")!;
    expect(peak.style.bottom).toBe("100%");
    expect(peak.style.transform).toBe("translateY(1px)");

    const second = makeHook();
    setHook(second);
    tick();
    expect(first.stop).toHaveBeenCalledTimes(1);
    expect(second.start).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    roots.length = 0;
    expect(second.stop).toHaveBeenCalledTimes(1);
  });

  it("follows a new preview hook even when the old stop() throws", () => {
    usePlayerStore.setState({ elements: [clip({ audioGroup: "vo" })] });
    const first = makeHook({ vo: { l: 1, r: 1 } });
    first.stop.mockImplementation(() => {
      throw new Error("dead realm");
    });
    setHook(first);
    mount();
    tick();
    const second = makeHook();
    setHook(second);
    tick();
    expect(second.start).toHaveBeenCalledTimes(1);
    tick();
    expect(second.read).toHaveBeenCalled();
  });

  it("drags a group fader through the live/quiet data-volume path, and the master fader through the player store", () => {
    const restoreRect = stubTrackRect();
    const originalPointerCapture = Element.prototype.setPointerCapture;
    Element.prototype.setPointerCapture = vi.fn();
    usePlayerStore.setState({ elements: [clip({ audioGroup: "vo", audioGroupLabel: "VO" })] });
    const { host } = mount();

    const groupFader = host.querySelector<HTMLElement>('[aria-label="VO volume"]')!;
    act(() => {
      groupFader.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, clientY: 25 }),
      );
    });
    // clientY 25 on a 0..100 track (stubTrackRect) is fraction 0.75; asserting
    // the exact computed value (not just "a string") also catches a NaN regression.
    const expectedVolume = String(fractionToLevel(0.75));
    expect(onSetAudioGroupAttributeLive).toHaveBeenCalledWith("vo", "data-volume", expectedVolume);
    expect(onSetAudioGroupAttributeQuiet).not.toHaveBeenCalled();
    act(() => {
      groupFader.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, pointerId: 1, clientY: 25 }),
      );
    });
    expect(onSetAudioGroupAttributeQuiet).toHaveBeenCalledWith(
      "vo",
      "data-volume",
      expectedVolume,
      "Set volume",
    );

    const masterFader = host.querySelector<HTMLElement>('[aria-label="Master volume"]')!;
    act(() => {
      masterFader.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, pointerId: 2, clientY: 0 }),
      );
    });
    expect(usePlayerStore.getState().audioVolume).toBe(1);
    act(() => {
      masterFader.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, pointerId: 2, clientY: 100 }),
      );
    });
    expect(usePlayerStore.getState().audioVolume).toBe(0);

    Element.prototype.setPointerCapture = originalPointerCapture;
    restoreRect();
  });

  it("nudges a consistent step in the visual (dB-scale) position, and aria-valuenow tracks the thumb", () => {
    usePlayerStore.setState({ elements: [clip({})], audioVolume: 0.5 });
    const { host } = mount();
    const masterFader = host.querySelector<HTMLElement>('[aria-label="Master volume"]')!;
    const startFraction = levelToFraction(0.5);
    expect(masterFader.getAttribute("aria-valuenow")).toBe(String(Math.round(startFraction * 100)));

    act(() => {
      masterFader.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    });
    const afterUp = usePlayerStore.getState().audioVolume;
    const fractionAfterUp = levelToFraction(afterUp);
    // A flat step in raw volume (the old, buggy behaviour) would move the
    // visual position by a very different amount depending on where it starts;
    // stepping in fraction space keeps every step visually the same size.
    expect(fractionAfterUp - startFraction).toBeCloseTo(0.02, 6);
    expect(masterFader.getAttribute("aria-valuenow")).toBe(
      String(Math.round(fractionAfterUp * 100)),
    );

    act(() => usePlayerStore.setState({ audioVolume: 0.5 }));
    act(() => {
      masterFader.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    const afterDown = usePlayerStore.getState().audioVolume;
    expect(startFraction - levelToFraction(afterDown)).toBeCloseTo(0.02, 6);
  });
});
