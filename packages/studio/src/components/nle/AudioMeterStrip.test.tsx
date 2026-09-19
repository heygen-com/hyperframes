// @vitest-environment happy-dom
// fallow-ignore-file code-duplication

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "../../player/store/playerStore";
import type { TimelineElement } from "../../player/store/timelineElement";
import { useAudioMetersVisible } from "../../utils/audioMeterVisibility";
import { AudioMeterStrip } from "./AudioMeterStrip";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const iframe = { contentWindow: null as unknown };
const previewIframeRef = { current: iframe };
vi.mock("../../contexts/StudioContext", () => ({
  useStudioShellContext: () => ({ previewIframeRef }),
}));

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
  usePlayerStore.setState({ elements: [] });
  useAudioMetersVisible.setState({ visible: true });
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
    tick();
    tick();
    expect(first.start).toHaveBeenCalledTimes(1);
    const fill = host.querySelector<HTMLElement>("[class*=bg-green-500]")!;
    expect(fill.style.transform).toBe("scaleY(1)");

    const second = makeHook();
    setHook(second);
    tick();
    expect(first.stop).toHaveBeenCalledTimes(1);
    expect(second.start).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    roots.length = 0;
    expect(second.stop).toHaveBeenCalledTimes(1);
  });
});
