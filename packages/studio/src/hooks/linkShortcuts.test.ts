// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore, type TimelineElement } from "../player";
import { dispatchLinkShortcut } from "./linkShortcuts";

const clip = (id: string, tag: string, extra: Partial<TimelineElement> = {}): TimelineElement => ({
  id,
  tag,
  src: "talk.mp4",
  start: 0,
  duration: 4,
  track: 0,
  ...extra,
});

function key(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { cancelable: true, ...init });
  vi.spyOn(event, "preventDefault");
  return event;
}

function select(elements: TimelineElement[], id: string) {
  usePlayerStore.getState().setElements(elements);
  usePlayerStore.getState().setSelection([id], id);
}

describe("dispatchLinkShortcut", () => {
  afterEach(() => vi.restoreAllMocks());

  it("⌘L unlinks the selected linked clip", () => {
    const video = clip("talk", "video", { muted: true, link: "lk-1" });
    const audio = clip("talk-audio", "audio", { link: "lk-1" });
    select([video, audio], "talk");
    const handleLinkEdit = vi.fn();
    const event = key({ metaKey: true, key: "l" });
    expect(dispatchLinkShortcut(event, { handleLinkEdit })).toBe(true);
    expect(handleLinkEdit).toHaveBeenCalledWith({ kind: "unlink", elements: [video, audio] });
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("⌥⇧D detaches audio, read by key code since Option changes the character", () => {
    const talk = clip("talk", "video", { hasAudio: true });
    select([talk], "talk");
    const handleLinkEdit = vi.fn();
    expect(
      dispatchLinkShortcut(key({ altKey: true, shiftKey: true, key: "Î", code: "KeyD" }), {
        handleLinkEdit,
      }),
    ).toBe(true);
    expect(handleLinkEdit).toHaveBeenCalledWith({ kind: "detach", element: talk });
  });

  it("⌥⌫ deletes one linked member", () => {
    const video = clip("talk", "video", { muted: true, link: "lk-1" });
    select([video, clip("talk-audio", "audio", { link: "lk-1" })], "talk");
    const handleTimelineElementDeleteOnly = vi.fn();
    dispatchLinkShortcut(key({ altKey: true, key: "Backspace" }), {
      handleLinkEdit: vi.fn(),
      handleTimelineElementDeleteOnly,
    });
    expect(handleTimelineElementDeleteOnly).toHaveBeenCalledWith(video);
  });

  it("leaves the key alone when no link item applies", () => {
    select([clip("title", "div")], "title");
    const event = key({ metaKey: true, key: "l" });
    expect(dispatchLinkShortcut(event, { handleLinkEdit: vi.fn() })).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
