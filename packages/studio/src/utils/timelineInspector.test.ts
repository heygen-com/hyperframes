import { describe, expect, it } from "vitest";
import { isAudioTimelineElement, isMusicTrack, resolveBeatSourceTrack } from "./timelineInspector";
import type { TimelineElement } from "../player";

// Minimal element factory for tests
function el(
  overrides: Partial<
    Pick<TimelineElement, "tag" | "src" | "id" | "domId" | "timelineRole" | "duration">
  >,
): Pick<TimelineElement, "tag" | "src" | "id" | "domId" | "timelineRole" | "duration"> {
  return {
    tag: "audio",
    src: "assets/track.mp3",
    id: "el-1",
    domId: "el-1",
    timelineRole: undefined,
    duration: 10,
    ...overrides,
  };
}

describe("isAudioTimelineElement", () => {
  it("is true for audio tag", () => {
    expect(isAudioTimelineElement(el({ tag: "audio" }))).toBe(true);
  });

  it("is true for music/sfx/narration semantic tags", () => {
    expect(isAudioTimelineElement(el({ tag: "music" }))).toBe(true);
    expect(isAudioTimelineElement(el({ tag: "sfx" }))).toBe(true);
    expect(isAudioTimelineElement(el({ tag: "narration" }))).toBe(true);
  });

  it("is true for img/div with an audio src extension", () => {
    expect(isAudioTimelineElement(el({ tag: "div", src: "assets/bg.mp3" }))).toBe(true);
    expect(isAudioTimelineElement(el({ tag: "div", src: "assets/fx.wav" }))).toBe(true);
  });

  it("is false for video and image elements", () => {
    expect(isAudioTimelineElement(el({ tag: "video", src: "assets/clip.mp4" }))).toBe(false);
    expect(isAudioTimelineElement(el({ tag: "img", src: "assets/logo.svg" }))).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(isAudioTimelineElement(null)).toBe(false);
    expect(isAudioTimelineElement(undefined)).toBe(false);
  });
});

describe("isMusicTrack", () => {
  it("is true when timelineRole is 'music'", () => {
    expect(isMusicTrack(el({ timelineRole: "music" }))).toBe(true);
  });

  it("is false for explicit non-music roles", () => {
    expect(isMusicTrack(el({ timelineRole: "sfx" }))).toBe(false);
    expect(isMusicTrack(el({ timelineRole: "voiceover" }))).toBe(false);
  });

  it("matches music-like ids when no role is set", () => {
    expect(isMusicTrack(el({ domId: "bgm", timelineRole: undefined }))).toBe(true);
    expect(isMusicTrack(el({ domId: "background_music", timelineRole: undefined }))).toBe(true);
    expect(isMusicTrack(el({ domId: "soundtrack", timelineRole: undefined }))).toBe(true);
  });

  it("is false for generic ids with no role", () => {
    expect(isMusicTrack(el({ domId: "my_audio_file", timelineRole: undefined }))).toBe(false);
    expect(isMusicTrack(el({ domId: "drop_1", timelineRole: undefined }))).toBe(false);
  });

  it("is false for non-audio elements even with a music-like id", () => {
    expect(isMusicTrack(el({ tag: "img", src: "assets/logo.svg", domId: "bgm" }))).toBe(false);
  });
});

describe("resolveBeatSourceTrack", () => {
  it("returns null when there are no elements", () => {
    expect(resolveBeatSourceTrack([])).toBeNull();
  });

  it("returns null when there are no audio elements", () => {
    const elements = [el({ tag: "img", src: "assets/logo.png" })];
    expect(resolveBeatSourceTrack(elements)).toBeNull();
  });

  it("returns isFallback=false for an explicitly tagged music track", () => {
    const music = el({ timelineRole: "music" });
    const result = resolveBeatSourceTrack([music]);
    expect(result).not.toBeNull();
    expect(result!.isFallback).toBe(false);
    expect(result!.element).toBe(music);
  });

  it("prefers the explicit music track over a longer untagged clip", () => {
    const music = el({ timelineRole: "music", duration: 30 });
    const other = el({ id: "drop_1", domId: "drop_1", timelineRole: undefined, duration: 120 });
    const result = resolveBeatSourceTrack([music, other]);
    expect(result!.element).toBe(music);
    expect(result!.isFallback).toBe(false);
  });

  it("falls back to the longest untagged audio clip when no music track exists", () => {
    const short = el({ id: "drop_1", domId: "drop_1", duration: 5, timelineRole: undefined });
    const long = el({ id: "drop_2", domId: "drop_2", duration: 60, timelineRole: undefined });
    const result = resolveBeatSourceTrack([short, long]);
    expect(result).not.toBeNull();
    expect(result!.isFallback).toBe(true);
    expect(result!.element).toBe(long);
  });

  it("excludes explicitly non-music roles (sfx, voiceover) from the fallback", () => {
    const sfx = el({ id: "sfx_1", domId: "sfx_1", timelineRole: "sfx", duration: 30 });
    const vo = el({ id: "vo_1", domId: "vo_1", timelineRole: "voiceover", duration: 20 });
    expect(resolveBeatSourceTrack([sfx, vo])).toBeNull();
  });

  it("returns isFallback=true for an untagged clip with a non-music id", () => {
    const clip = el({ id: "my_audio_file", domId: "my_audio_file", timelineRole: undefined });
    const result = resolveBeatSourceTrack([clip]);
    expect(result!.isFallback).toBe(true);
  });
});
