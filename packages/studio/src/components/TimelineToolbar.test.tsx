// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { usePlayerStore } from "../player/store/playerStore";
import { makeSelection } from "../hooks/domSelectionTestHarness";
import { shouldIgnorePlaybackShortcutTarget } from "../player/lib/playbackShortcuts";
import { isTypingTarget } from "../utils/typingTarget";
import { TimelineToolbar } from "./TimelineToolbar";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  usePlayerStore.setState({ autoKeyframeEnabled: true, thumbnailMode: "adaptive" });
});

function renderToolbar(
  domEditSession?: React.ComponentProps<typeof TimelineToolbar>["domEditSession"],
) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(<TimelineToolbar domEditSession={domEditSession} />);
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
});

// KTD13. Before the sweep every control here was a `<button>` and the zoom
// slider a native `<input type="range">`, so both global hotkey filters skipped
// all of them. A primitive that renders a different role would let a playback
// shortcut fire out of a focused toolbar control, or block one, and nothing in
// the diff would say so.
describe("TimelineToolbar — hotkey classification (KTD13)", () => {
  it("keeps every button out of the playback shortcuts' reach", () => {
    const { host, root } = renderToolbar();
    const buttons = [...host.querySelectorAll("button")];

    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(shouldIgnorePlaybackShortcutTarget(button)).toBe(true);
    }
    act(() => root.unmount());
  });

  it("keeps the zoom slider a typing target, the way the range input was", () => {
    const { host, root } = renderToolbar();
    // Base UI's Slider keeps a real `<input type="range">` inside the thumb and
    // focus lands on it, which is why the classification did not have to move.
    const input = host.querySelector('input[type="range"][aria-label="Timeline zoom"]');

    expect(input).not.toBeNull();
    expect(isTypingTarget(input)).toBe(true);
    act(() => root.unmount());
  });
});

/**
 * Moves a range input the way a real pointer does. Assigning `input.value`
 * directly updates React's own value tracker as a side effect, so React
 * decides nothing changed and swallows the event; the prototype's setter is
 * the one the browser uses and the one the tracker can still see past.
 */
function setRangeValue(input: HTMLInputElement, value: number): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("no value setter on HTMLInputElement");
  setter.call(input, String(value));
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("TimelineToolbar — zoom", () => {
  it("leaves fit mode and applies the slider's value", () => {
    usePlayerStore.setState({ zoomMode: "fit", manualZoomPercent: 100, timelineFitPps: 20 });
    const { host, root } = renderToolbar();
    const input = host.querySelector<HTMLInputElement>('input[type="range"]');
    if (!input) throw new Error("zoom slider not rendered");

    act(() => setRangeValue(input, 80));

    const state = usePlayerStore.getState();
    expect(state.zoomMode).toBe("manual");
    expect(state.manualZoomPercent).toBeGreaterThan(100);
    act(() => root.unmount());
  });

  // The readout printed the word "Fit" in fit mode, right beside the Fit
  // button: two identical labels side by side, one of which did nothing when
  // pressed. It is a number in both modes now.
  it("reads out a percentage in fit mode instead of repeating the Fit button", () => {
    usePlayerStore.setState({ zoomMode: "fit", manualZoomPercent: 100 });
    const { host, root } = renderToolbar();
    const readout = host.querySelector('[aria-label="Timeline zoom level"]');

    expect(readout?.textContent).toMatch(/^\d+%$/);
    act(() => root.unmount());
  });
});
