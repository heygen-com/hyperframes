// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { usePlayerStore } from "../player/store/playerStore";
import { makeSelection } from "../hooks/domSelectionTestHarness";
import { useAudioMetersVisible } from "../utils/audioMeterVisibility";
import { readStudioUiPreferences } from "../utils/studioUiPreferences";
import { AudioMeterStrip } from "./nle/AudioMeterStrip";
import { TimelineToolbar } from "./TimelineToolbar";

vi.mock("../contexts/StudioContext", () => ({
  useStudioShellContextOptional: () => ({
    previewIframeRef: { current: null },
    editHistory: { canUndo: false, canRedo: false },
    handleUndo: vi.fn(),
    handleRedo: vi.fn(),
  }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  usePlayerStore.setState({
    autoKeyframeEnabled: true,
    thumbnailMode: "adaptive",
    zoomMode: "fit",
  });
});

function renderToolbar(
  domEditSession?: React.ComponentProps<typeof TimelineToolbar>["domEditSession"],
  props: Partial<React.ComponentProps<typeof TimelineToolbar>> = {},
) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(<TimelineToolbar domEditSession={domEditSession} {...props} />);
  });
  return { host, root };
}

// Regression (#1808): the auto-keyframe toggle is a GLOBAL setting (unlike the
// diamond "Add keyframe" button, which needs a selection to mean anything), so
// it must stay visible and usable with nothing selected — it must not be
// gated behind `domEditSession`/`onToggleKeyframe`.
describe("TimelineToolbar — auto-keyframe toggle (#1808)", () => {
  it("renders enabled (pressed) by default with no selection", () => {
    const { host, root } = renderToolbar();
    const btn = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Auto-record manual edits as keyframes"]',
    );
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute("aria-pressed")).toBe("true");
    act(() => root.unmount());
  });

  it("flips autoKeyframeEnabled in the store when clicked", () => {
    const { host, root } = renderToolbar();
    const btn = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Auto-record manual edits as keyframes"]',
    );
    if (!btn) throw new Error("auto-keyframe toggle not rendered");

    act(() => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(usePlayerStore.getState().autoKeyframeEnabled).toBe(false);
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    act(() => root.unmount());
  });
});

describe("TimelineToolbar — adaptive thumbnails", () => {
  it("keeps a user-controlled hidden mode as the rollback path", () => {
    const { host, root } = renderToolbar();
    const button = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Hide thumbnails — labels only"]',
    );
    if (!button) throw new Error("thumbnail toggle not rendered");

    act(() => button.click());

    expect(usePlayerStore.getState().thumbnailMode).toBe("hidden");
    expect(button.getAttribute("aria-label")).toBe(
      "Show thumbnails — posters stay visible; richer previews appear on interaction",
    );
    act(() => root.unmount());
  });
});

describe("TimelineToolbar — motion path endpoints", () => {
  it("does not advertise a destructive keyframe toggle for a required endpoint", () => {
    usePlayerStore.setState({ currentTime: 10 });
    const animation: GsapAnimation = {
      id: "#el-to-0-position",
      targetSelector: "#el",
      method: "to",
      position: 0,
      duration: 10,
      properties: {},
      keyframes: {
        format: "object-array",
        keyframes: [
          { percentage: 0, properties: { x: 0, y: 0 } },
          { percentage: 100, properties: { x: 100, y: 0 } },
        ],
      },
      arcPath: {
        enabled: true,
        autoRotate: false,
        segments: [{ curviness: 1 }],
      },
    };
    const element = document.createElement("div");
    element.id = "el";
    const session = {
      domEditSelection: makeSelection("Element", element),
      selectedGsapAnimations: [animation],
      handleGsapAddAnimation: vi.fn(),
      handleGsapConvertToKeyframes: vi.fn(),
      handleGsapRemoveKeyframe: vi.fn(),
    } satisfies NonNullable<React.ComponentProps<typeof TimelineToolbar>["domEditSession"]>;

    const { host, root } = renderToolbar(session);
    const button = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Motion path endpoint"]',
    );
    expect(button?.disabled).toBe(true);
    act(() => root.unmount());
  });
});

describe("TimelineToolbar — keyframes on audio tracks", () => {
  const clip = (tag: string) => ({
    id: "bgm",
    key: "bgm",
    tag,
    start: 0,
    duration: 10,
    track: 1,
  });

  /** A session whose selection would otherwise offer the keyframe toggle. */
  function sessionFor(tag: string) {
    usePlayerStore.setState({ elements: [clip(tag)], selectedElementId: "bgm", currentTime: 1 });
    const element = document.createElement(tag);
    element.id = "bgm";
    return {
      domEditSelection: makeSelection("Element", element),
      selectedGsapAnimations: [],
      handleGsapAddAnimation: vi.fn(),
      handleGsapConvertToKeyframes: vi.fn(),
      handleGsapRemoveKeyframe: vi.fn(),
    } satisfies NonNullable<React.ComponentProps<typeof TimelineToolbar>["domEditSession"]>;
  }

  it("offers no keyframe toggle for an audio clip", () => {
    // An audio clip has no box on the canvas, so there is nothing to move or fade —
    // and pressing this seeded a tween from the position properties, which put a
    // position lane on a track that has no position. Audio is automated instead.
    const { host, root } = renderToolbar(sessionFor("audio"));
    const button = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Add keyframe at playhead"]',
    );
    expect(button?.disabled).toBe(true);
    act(() => root.unmount());
  });

  it("still offers it for a visual clip", () => {
    const { host, root } = renderToolbar(sessionFor("div"));
    const button = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Add keyframe at playhead"]',
    );
    expect(button?.disabled).toBe(false);
    act(() => root.unmount());
  });

  const keyframeControls = (host: HTMLElement) => [
    host.querySelector('button[aria-label="Add keyframe at playhead"]'),
    host.querySelector('button[aria-label="Auto-record manual edits as keyframes"]'),
  ];
  /** True when the keyframe shortcut claimed K, so playback never saw it. */
  const pressK = () => {
    const event = new KeyboardEvent("keydown", { key: "k", bubbles: true, cancelable: true });
    act(() => {
      window.dispatchEvent(event);
    });
    return event.defaultPrevented;
  };

  it("shows Add keyframe and auto-record, and K adds a keyframe, by default", () => {
    const { host, root } = renderToolbar(sessionFor("div"));
    expect(keyframeControls(host).every(Boolean)).toBe(true);
    expect(pressK()).toBe(true);
    act(() => root.unmount());
  });

  it("hides both controls for a host without keyframes, turns auto-record off and leaves K alone", () => {
    const { host, root } = renderToolbar(sessionFor("div"), { showKeyframes: false });
    expect(keyframeControls(host)).toEqual([null, null]);
    expect(usePlayerStore.getState().autoKeyframeEnabled).toBe(false);
    expect(pressK()).toBe(false);
    act(() => root.unmount());
  });
});

describe("TimelineToolbar Fit", () => {
  it("shows Fit as a named icon and says whether fit is on", () => {
    const { host, root } = renderToolbar();
    const fit = () => host.querySelector('button[aria-label="Fit timeline to width"]');
    expect(fit()?.textContent).toBe("");
    expect(fit()?.querySelector("svg")).not.toBeNull();
    act(() => fit()?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(fit()?.getAttribute("aria-pressed")).toBe("true");
    act(() =>
      host
        .querySelector('button[aria-label="Zoom in"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(fit()?.getAttribute("aria-pressed")).toBe("false");
    act(() => root.unmount());
  });

  it("counts a zoom-in click as a person's zoom, so the timeline anchors it on the playhead", () => {
    const { host, root } = renderToolbar();
    const before = usePlayerStore.getState().userZoomCount;
    act(() =>
      host
        .querySelector('button[aria-label="Zoom in"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(usePlayerStore.getState().userZoomCount).toBe(before + 1);
    act(() => root.unmount());
  });
});

describe("TimelineToolbar audio meters", () => {
  it("keeps fresh preferences hidden until the user opts in and persists the choice", () => {
    localStorage.clear();
    useAudioMetersVisible.setState(useAudioMetersVisible.getInitialState());
    usePlayerStore.setState({
      elements: [{ id: "music", key: "music", tag: "audio", start: 0, duration: 10, track: 1 }],
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      act(() =>
        root.render(
          <>
            <TimelineToolbar />
            <AudioMeterStrip />
          </>,
        ),
      );
      const button = host.querySelector<HTMLButtonElement>(
        'button[aria-label="Toggle audio meters"]',
      );
      expect(readStudioUiPreferences().audioMetersVisible).toBeUndefined();
      expect(button?.getAttribute("aria-pressed")).toBe("false");
      expect(host.querySelector('[data-testid="audio-meter-strip"]')).toBeNull();
      if (!button) throw new Error("audio meter toggle not rendered");
      act(() => button.click());
      expect(button.getAttribute("aria-pressed")).toBe("true");
      expect(host.querySelector('[data-testid="audio-meter-strip"]')).not.toBeNull();
      expect(readStudioUiPreferences().audioMetersVisible).toBe(true);
    } finally {
      act(() => root.unmount());
      useAudioMetersVisible.setState(useAudioMetersVisible.getInitialState());
      localStorage.clear();
    }
  });
});

describe("TimelineToolbar add beat", () => {
  it("shows Add beat by default, as Studio does", () => {
    const { host, root } = renderToolbar();
    expect(host.querySelector('button[aria-label="Add beat at playhead"]')).not.toBeNull();
    act(() => root.unmount());
  });
});
