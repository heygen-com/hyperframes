import { describe, expect, it } from "vitest";
import {
  AUDIBLE_MEDIA_SELECTOR,
  audibleVideoNeedsWebAudio,
  isAudibleVideoElement,
  playableAudioTrack,
} from "./audibleVideo";

const el = (tagName: string, attrs: Record<string, string>) => ({
  tagName,
  hasAttribute: (n: string) => n in attrs,
  getAttribute: (n: string) => (n in attrs ? (attrs[n] ?? null) : null),
});

describe("isAudibleVideoElement", () => {
  it("unmuted video with data-has-audio=true or no attribute is audible", () => {
    expect(isAudibleVideoElement(el("VIDEO", { "data-has-audio": "true" }))).toBe(true);
    expect(isAudibleVideoElement(el("video", {}))).toBe(true);
  });
  it("muted, false or empty is not audible", () => {
    expect(isAudibleVideoElement(el("VIDEO", { muted: "" }))).toBe(false);
    expect(isAudibleVideoElement(el("VIDEO", { "data-has-audio": "false" }))).toBe(false);
    expect(isAudibleVideoElement(el("VIDEO", { "data-has-audio": "" }))).toBe(false);
  });
  it("only the exact value true counts, so TRUE is not audible", () => {
    expect(isAudibleVideoElement(el("VIDEO", { "data-has-audio": "TRUE" }))).toBe(false);
  });
  it("never true for non-video", () => {
    expect(isAudibleVideoElement(el("AUDIO", {}))).toBe(false);
  });
});

describe("AUDIBLE_MEDIA_SELECTOR", () => {
  it("matches audio plus exactly the videos the predicate calls audible", () => {
    document.body.innerHTML = `
      <audio id="a" data-start="0"></audio>
      <video id="v-true" data-start="0" data-has-audio="true"></video>
      <video id="v-absent" data-start="0"></video>
      <video id="v-muted" data-start="0" data-has-audio="true" muted></video>
      <video id="v-false" data-start="0" data-has-audio="false"></video>
      <video id="v-empty" data-start="0" data-has-audio=""></video>`;
    const matched = Array.from(document.querySelectorAll(AUDIBLE_MEDIA_SELECTOR), (n) => n.id);
    expect(matched).toEqual(["a", "v-true", "v-absent"]);
    const audibleVideos = Array.from(document.querySelectorAll("video"))
      .filter(isAudibleVideoElement)
      .map((n) => n.id);
    expect(audibleVideos).toEqual(matched.filter((id) => id.startsWith("v-")));
  });
});

describe("audibleVideoNeedsWebAudio", () => {
  it("keeps a unity, unprocessed video on native output", () => {
    expect(audibleVideoNeedsWebAudio({})).toBe(false);
    expect(audibleVideoNeedsWebAudio({ volume: 1, masterChain: null })).toBe(false);
    expect(audibleVideoNeedsWebAudio({ masterChain: "" })).toBe(false);
    expect(audibleVideoNeedsWebAudio({ volume: 1, fxChain: "", automation: null })).toBe(false);
    expect(audibleVideoNeedsWebAudio({ volume: Number.NaN })).toBe(false);
  });

  it.each([
    { volume: 1.5 },
    { fxChain: "[]" },
    { automation: "{}" },
    { audioGroup: "music" },
    { volume: 1, masterChain: '{"version":1,"nodes":[]}' },
  ])("routes a video carrying %o", (fields) => {
    expect(audibleVideoNeedsWebAudio(fields)).toBe(true);
  });
});

describe("playableAudioTrack", () => {
  const video = { codec_type: "video", codec_name: "hevc" };
  const aac = { codec_type: "audio", codec_name: "aac" };
  const spatial = { codec_type: "audio", codec_name: "unknown" };

  it("skips an iPhone spatial track ffprobe cannot name, counting audio streams only", () => {
    expect(playableAudioTrack([video, spatial, aac])).toBe(1);
    expect(playableAudioTrack([video, aac, spatial])).toBe(0);
    expect(playableAudioTrack([video, { codec_type: "audio" }, aac])).toBe(1);
  });
  it("has no answer when no audio stream plays", () => {
    expect(playableAudioTrack([video, spatial])).toBeUndefined();
    expect(playableAudioTrack([video])).toBeUndefined();
  });
});
