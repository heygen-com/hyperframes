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
import { PlainTrackHeader, VisibilityButton } from "./TimelineTrackPlainHeader";

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

  // The callback acts on the REAL track key; the display row rides along so the
  // undo-history label announces the same row this button just did, instead of
  // re-deriving it from an ordering that has no group anchors in it.
  it("toggles the real track number and passes the row it announced", () => {
    const view = renderButton({ hidden: false, isAudioTrack: true, trackDisplayNumber: 2 });
    view.host.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(view.onToggle).toHaveBeenCalledWith(7, true, 2);
    view.unmount();
  });
});

describe("PlainTrackHeader", () => {
  function renderHeader(overrides: Partial<Parameters<typeof PlainTrackHeader>[0]> = {}) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onToggleSolo = vi.fn();
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
          isGroupMuted: false,
          isSoloed: false,
          onToggleSolo,
          ...overrides,
        }),
      ),
    );
    return { host, unmount: () => act(() => root.unmount()), onToggleSolo };
  }

  const soloButton = (host: HTMLElement) =>
    host.querySelector('button[aria-label="Hear only this"]');
  const labelSpan = (host: HTMLElement) => host.querySelector("span.min-w-0");

  it("offers solo on an audio track and reports its pressed state", () => {
    const view = renderHeader({ isSoloed: true });
    expect(soloButton(view.host)?.getAttribute("aria-pressed")).toBe("true");
    view.unmount();
  });

  it("withholds solo from a visual track", () => {
    const view = renderHeader({ isAudioTrack: false });
    expect(soloButton(view.host)).toBeNull();
    view.unmount();
  });

  // A group-muted member is silent without being hidden itself, so the strike
  // is the only thing that says so — and the title has to explain why, since a
  // user who never touched THIS row's mute is looking for the reason.
  it("strikes the label through when the row's own mute is on", () => {
    const view = renderHeader({ isTrackHidden: true });
    expect(labelSpan(view.host)?.className).toContain("line-through");
    view.unmount();
  });

  it("strikes it through for a group mute too, and says which", () => {
    const view = renderHeader({ isGroupMuted: true });
    expect(labelSpan(view.host)?.className).toContain("line-through");
    expect(labelSpan(view.host)?.getAttribute("title")).toBe("Voiceover (group muted)");
    view.unmount();
  });

  it("leaves an audible row unstruck", () => {
    const view = renderHeader();
    expect(labelSpan(view.host)?.className).not.toContain("line-through");
    expect(labelSpan(view.host)?.getAttribute("title")).toBe("Voiceover");
    view.unmount();
  });
});
