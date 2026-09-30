import { describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { resolveLinkMenuItems } from "./clipMenuLinkItems";

const clip = (id: string, tag: string, extra: Partial<TimelineElement> = {}): TimelineElement => ({
  id,
  tag,
  src: "talk.mp4",
  start: 0,
  duration: 4,
  track: 0,
  ...extra,
});

function labels(element: TimelineElement, elements: TimelineElement[], selected: string[] = []) {
  return resolveLinkMenuItems({
    element,
    elements,
    selectedKeys: new Set(selected),
    onLinkEdit: vi.fn(),
    onDeleteElementOnly: vi.fn(),
  }).map((item) => item.label);
}

describe("resolveLinkMenuItems", () => {
  it("offers Detach audio on a video with sound (frame 4)", () => {
    const talk = clip("talk", "video", { hasAudio: true });
    expect(labels(talk, [talk])).toEqual(["Detach audio"]);
  });

  it("offers Unlink, Merge back and Delete this clip only on a linked pair (frame 6)", () => {
    const video = clip("talk", "video", { muted: true, link: "lk-1" });
    const audio = clip("talk-audio", "audio", { link: "lk-1" });
    expect(labels(audio, [video, audio])).toEqual([
      "Unlink from video",
      "Merge audio back into video",
      "Delete this clip only",
    ]);
  });

  it("offers Link instead of Unlink for a selected unlinked pair", () => {
    const video = clip("talk", "video", { muted: true });
    const audio = clip("talk-audio", "audio");
    expect(labels(video, [video, audio], ["talk", "talk-audio"])).toEqual([
      "Link to audio",
      "Merge audio back into video",
    ]);
    expect(labels(audio, [video, audio], ["talk", "talk-audio"])[0]).toBe("Link to video");
  });

  it("names the audio partner when unlinking from the video side", () => {
    const video = clip("talk", "video", { muted: true, link: "lk-1" });
    const audio = clip("talk-audio", "audio", { link: "lk-1" });
    expect(labels(video, [video, audio])[0]).toBe("Unlink from audio");
  });

  it("falls back to plain Unlink for groups of three or same-kind partners", () => {
    const video = clip("talk", "video", { muted: true, link: "lk-1" });
    const audio = clip("talk-audio", "audio", { link: "lk-1" });
    const second = clip("talk-audio2", "audio", { link: "lk-1" });
    expect(labels(video, [video, audio, second])[0]).toBe("Unlink");
    const twin = clip("talk2", "video", { muted: true, link: "lk-2" });
    const twin2 = clip("talk3", "video", { muted: true, link: "lk-2" });
    expect(labels(twin, [twin, twin2])[0]).toBe("Unlink");
  });

  it("offers nothing for a silent video or without a link handler", () => {
    const broll = clip("broll", "video", { muted: true, src: "b.mp4" });
    expect(labels(broll, [broll])).toEqual([]);
    expect(
      resolveLinkMenuItems({
        element: clip("t", "video", { hasAudio: true }),
        elements: [],
        selectedKeys: new Set(),
      }),
    ).toEqual([]);
  });

  it("each item dispatches its link edit", () => {
    const onLinkEdit = vi.fn();
    const talk = clip("talk", "video", { hasAudio: true });
    resolveLinkMenuItems({
      element: talk,
      elements: [talk],
      selectedKeys: new Set(),
      onLinkEdit,
    })[0]?.run();
    expect(onLinkEdit).toHaveBeenCalledWith({ kind: "detach", element: talk });
  });
});
