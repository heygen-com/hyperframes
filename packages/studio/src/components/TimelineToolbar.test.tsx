// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { usePlayerStore } from "../player/store/playerStore";
import { makeSelection } from "../hooks/domSelectionTestHarness";
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
