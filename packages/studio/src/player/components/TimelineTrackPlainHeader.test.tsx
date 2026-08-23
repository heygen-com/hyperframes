// @vitest-environment happy-dom

/**
 * The visibility control's accessible contract.
 *
 * The wording ran behind the `audio-track-mute` canary at 0%, so it had never
 * rendered in any suite: it returned "Muted" / "Mute", which named the CURRENT
 * state rather than the action, and dropped the track suffix so every audio row
 * shared one accessible name. Pinned here because the label, the icon and the
 * callback's arguments are the whole identity of this control.
 *
 * The mute presentation itself is gone (`remove mute and solo from tracks and
 * groups`): the control is the visibility eye it always was, and an audio row
 * renders it only when already hidden, which is the way back out.
 */

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlainTrackHeader, VisibilityButton } from "./TimelineTrackPlainHeader";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

function renderButton(props: {
  hidden: boolean;
  visible?: boolean;
  trackDisplayNumber: number | null;
}): { host: HTMLElement; unmount: () => void; onToggle: ReturnType<typeof vi.fn> } {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onToggle = vi.fn();
  act(() =>
    root.render(
      React.createElement(VisibilityButton, {
        hidden: props.hidden,
        trackNumber: 7,
        trackDisplayNumber: props.trackDisplayNumber,
        visible: props.visible ?? true,
        onToggle,
      }),
    ),
  );
  return { host, unmount: () => act(() => root.unmount()), onToggle };
}

const labelOf = (host: HTMLElement) => host.querySelector("button")?.getAttribute("aria-label");

describe("VisibilityButton", () => {
  it("names the action, not the state", () => {
    const shown = renderButton({ hidden: false, trackDisplayNumber: 2 });
    expect(labelOf(shown.host)).toBe("Hide track 2");
    shown.unmount();
    const hiddenRow = renderButton({ hidden: true, trackDisplayNumber: 2 });
    expect(labelOf(hiddenRow.host)).toBe("Show track 2");
    hiddenRow.unmount();
  });

  it("keeps each row's name unique, so two tracks are distinguishable", () => {
    const first = renderButton({ hidden: false, trackDisplayNumber: 1 });
    const second = renderButton({ hidden: false, trackDisplayNumber: 3 });
    expect(labelOf(first.host)).toBe("Hide track 1");
    expect(labelOf(second.host)).toBe("Hide track 3");
    expect(labelOf(first.host)).not.toBe(labelOf(second.host));
    first.unmount();
    second.unmount();
  });

  // The callback acts on the REAL track key; the display row rides along so the
  // undo-history label announces the same row this button just did, instead of
  // re-deriving it from an ordering that has no group anchors in it.
  it("toggles the real track number and passes the row it announced", () => {
    const view = renderButton({ hidden: false, trackDisplayNumber: 2 });
    view.host.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(view.onToggle).toHaveBeenCalledWith(7, true, 2);
    view.unmount();
  });

  // `visible={false}` renders a SPACER, not nothing: every row's control
  // columns have to line up whether or not this row offers the control.
  it("holds the column with a spacer when withheld", () => {
    const view = renderButton({ hidden: false, visible: false, trackDisplayNumber: 2 });
    expect(view.host.querySelector("button")).toBeNull();
    expect(view.host.querySelector("span")).toBeTruthy();
    view.unmount();
  });
});

describe("PlainTrackHeader", () => {
  function renderHeader(overrides: Partial<Parameters<typeof PlainTrackHeader>[0]> = {}) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() =>
      root.render(
        React.createElement(PlainTrackHeader, {
          trackNumber: 0,
          trackDisplayNumber: 1,
          trackLabel: "Voiceover",
          clipCount: 1,
          isTrackHidden: false,
          isAudioTrack: true,
          onToggleTrackHidden: vi.fn(),
          showTrackLabel: true,
          ...overrides,
        }),
      ),
    );
    return { host, unmount: () => act(() => root.unmount()) };
  }

  // A row that says what it is with a speaker does not also need the hide
  // affordance sitting in the eye's slot.
  it("withholds the eye from an audible audio track", () => {
    const view = renderHeader();
    expect(view.host.querySelector("button")).toBeNull();
    view.unmount();
  });

  // Withholding it unconditionally withheld the only way back: `data-hidden`
  // silences the clip in preview and drops it from the render, and nothing else
  // writes it, so a track hidden by hand or by "Hide all" was silent with no
  // control anywhere to restore it.
  it("offers it back once the audio track is hidden", () => {
    const view = renderHeader({ isTrackHidden: true });
    expect(labelOf(view.host)).toBe("Show track 1");
    view.unmount();
  });

  it("keeps the eye on a visual track", () => {
    const view = renderHeader({ isAudioTrack: false });
    expect(labelOf(view.host)).toBe("Hide track 1");
    view.unmount();
  });
});
