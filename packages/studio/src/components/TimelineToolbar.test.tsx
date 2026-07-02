// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "../player/store/playerStore";
import { TimelineToolbar } from "./TimelineToolbar";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  usePlayerStore.setState({ autoKeyframeEnabled: true });
});

function renderToolbar() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(<TimelineToolbar toggleTimelineVisibility={vi.fn()} />);
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
    const btn = host.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
    expect(btn).not.toBeNull();
    act(() => root.unmount());
  });

  it("flips autoKeyframeEnabled in the store when clicked", () => {
    const { host, root } = renderToolbar();
    const btn = host.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')!;

    act(() => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(usePlayerStore.getState().autoKeyframeEnabled).toBe(false);
    expect(host.querySelector('button[aria-pressed="false"]')).not.toBeNull();
    act(() => root.unmount());
  });
});
