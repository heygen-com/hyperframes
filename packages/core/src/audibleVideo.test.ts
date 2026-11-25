import { describe, expect, it } from "vitest";
import {
  AUDIBLE_MEDIA_SELECTOR,
  audibleVideoNeedsWebAudio,
  isAudibleVideoElement,
  PARENT_COPY_ATTRIBUTES,
  parentCopyKey,
  parentCopyOf,
} from "./audibleVideo";
import { HF_AUDIO_FADE_IN_ATTR, HF_AUDIO_FADE_OUT_ATTR } from "./audioFade";
import { HF_AUDIO_FX_ATTR } from "./audioFx";
import { HF_AUDIO_AUTOMATION_ATTR } from "./audioAutomation";
import { HF_AUDIO_GROUP_ATTR } from "./audioGroups";

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

describe("parentCopyOf", () => {
  const media = (html: string) => {
    document.body.innerHTML = html;
    return document.body.firstElementChild as HTMLMediaElement;
  };

  it("names a timed clip's file at the document's address, its window and where in the file it begins", () => {
    expect(
      parentCopyOf(
        media(
          '<audio src="music/a.m4a" data-start="2" data-duration="5" data-media-start="1.5"></audio>',
        ),
      ),
    ).toEqual({
      kind: "audio",
      src: new URL("music/a.m4a", document.baseURI).href,
      start: 2,
      duration: 5,
      mediaStart: 1.5,
      loop: false,
      attrs: {},
    });
  });

  // fails without the fix: a parent copy lost the clip's loop, rate, fades and volume, so a decoded copy was wrong.
  it("carries the clip's loop and the attributes a decoded copy is played by", () => {
    const copy = parentCopyOf(
      media(
        '<audio src="a.m4a" data-start="0" loop data-volume="0.5" data-fade-in="1" data-fade-out="2" data-playback-rate="1.25" data-fx-chain="[]" data-audio-group="music" data-automation="{}" title="x"></audio>',
      ),
    );
    expect(copy?.loop).toBe(true);
    expect(copy?.attrs).toEqual({
      "data-volume": "0.5",
      "data-fade-in": "1",
      "data-fade-out": "2",
      "data-playback-rate": "1.25",
      "data-fx-chain": "[]",
      "data-audio-group": "music",
      "data-automation": "{}",
    });
  });

  it("lists the attributes the transport reads under their own names", () => {
    expect(PARENT_COPY_ATTRIBUTES).toEqual(
      expect.arrayContaining([
        HF_AUDIO_FADE_IN_ATTR,
        HF_AUDIO_FADE_OUT_ATTR,
        HF_AUDIO_FX_ATTR,
        HF_AUDIO_AUTOMATION_ATTR,
        HF_AUDIO_GROUP_ATTR,
      ]),
    );
  });

  it("names a clip the same way whatever its src is rewritten to on the other side", () => {
    const copy = { kind: "audio" as const, src: "https://a.test/x.m4a", start: 1, mediaStart: 0 };
    expect(parentCopyKey({ ...copy, duration: 4, loop: true } as never)).toBe(parentCopyKey(copy));
    expect(parentCopyKey({ ...copy, start: 2 })).not.toBe(parentCopyKey(copy));
  });

  it("reads a <source> child and gives an open-ended clip no end", () => {
    expect(parentCopyOf(media('<video data-start="0"><source src="b.mp4"></video>'))).toMatchObject(
      { kind: "video", src: new URL("b.mp4", document.baseURI).href, duration: Infinity },
    );
  });

  it("copies nothing a render would not hear, or a clip the preloader has put off", () => {
    expect(parentCopyOf(media('<video src="v.mp4" data-start="0" muted></video>'))).toBeNull();
    expect(
      parentCopyOf(media('<video src="v.mp4" data-start="0" data-has-audio="false"></video>')),
    ).toBeNull();
    expect(
      parentCopyOf(media('<audio src="a.m4a" data-start="0" preload="metadata"></audio>')),
    ).toBeNull();
    expect(
      parentCopyOf(media('<audio src="a.m4a" data-start="0" preload="none"></audio>')),
    ).toBeNull();
    expect(parentCopyOf(media('<audio data-start="0"></audio>'))).toBeNull();
  });

  it("gives a clip whose file address is invalid no copy, and leaves the others alone", () => {
    document.body.innerHTML =
      '<audio src="https://[" data-start="0"></audio><audio src="b.m4a" data-start="0"></audio>';
    const copies = [...document.querySelectorAll("audio")].map((el) => parentCopyOf(el));
    expect(copies.map((c) => c?.src ?? null)).toEqual([
      null,
      new URL("b.m4a", document.baseURI).href,
    ]);
  });
});
