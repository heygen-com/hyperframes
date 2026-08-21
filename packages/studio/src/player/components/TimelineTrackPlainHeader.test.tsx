// @vitest-environment happy-dom

/**
 * The visibility control's accessible contract.
 *
 * The audio wording ran behind the `audio-track-mute` canary at 0%, so it had
 * never rendered in any suite: it returned "Muted" / "Mute", which named the
 * CURRENT state rather than the action, and dropped the track suffix so every
 * audio row shared one accessible name. Music plus VO is the ordinary case, so
 * that is two identical buttons. Pinned here because the label and the icon are
 * the whole identity of this control.
 */

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VisibilityButton } from "./TimelineTrackPlainHeader";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

function renderButton(props: {
  hidden: boolean;
  isAudioTrack?: boolean;
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
        visible: true,
        isAudioTrack: props.isAudioTrack,
        onToggle,
      }),
    ),
  );
  return { host, unmount: () => act(() => root.unmount()), onToggle };
}

const labelOf = (host: HTMLElement) => host.querySelector("button")?.getAttribute("aria-label");

describe("VisibilityButton", () => {
  it("names the action, not the state, on an audible audio track", () => {
    const view = renderButton({ hidden: false, isAudioTrack: true, trackDisplayNumber: 2 });
    expect(labelOf(view.host)).toBe("Mute track 2");
    view.unmount();
  });

  // The half that was wrong: a muted row read "Muted", so nothing told a
  // screen-reader user that activating it would unmute.
  it("promises the un-mute when the audio track is already muted", () => {
    const view = renderButton({ hidden: true, isAudioTrack: true, trackDisplayNumber: 2 });
    expect(labelOf(view.host)).toBe("Unmute track 2");
    view.unmount();
  });

  it("keeps each audio row's name unique, so two tracks are distinguishable", () => {
    const first = renderButton({ hidden: false, isAudioTrack: true, trackDisplayNumber: 1 });
    const second = renderButton({ hidden: false, isAudioTrack: true, trackDisplayNumber: 3 });
    expect(labelOf(first.host)).toBe("Mute track 1");
    expect(labelOf(second.host)).toBe("Mute track 3");
    expect(labelOf(first.host)).not.toBe(labelOf(second.host));
    first.unmount();
    second.unmount();
  });

  it("still says Hide/Show on a visual track", () => {
    const shown = renderButton({ hidden: false, trackDisplayNumber: 2 });
    expect(labelOf(shown.host)).toBe("Hide track 2");
    shown.unmount();
    const hiddenRow = renderButton({ hidden: true, trackDisplayNumber: 2 });
    expect(labelOf(hiddenRow.host)).toBe("Show track 2");
    hiddenRow.unmount();
  });

  // The callback takes the REAL track key; only the text takes the display row.
  it("toggles the real track number, not the display number", () => {
    const view = renderButton({ hidden: false, isAudioTrack: true, trackDisplayNumber: 2 });
    view.host.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(view.onToggle).toHaveBeenCalledWith(7, true);
    view.unmount();
  });
});
