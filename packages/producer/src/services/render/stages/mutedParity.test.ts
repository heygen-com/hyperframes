import { describe, expect, it } from "bun:test";
import { pruneMutedBrowserMedia } from "./probeStage.js";
import { appendAutoDetectedVideoAudio } from "./extractVideosStage.js";
import { collectRenderMedia } from "../../renderMediaCollector.js";

describe("pruneMutedBrowserMedia", () => {
  it("drops muted audio from the mix and clears hasAudio on muted video", () => {
    const composition = {
      videos: [
        { id: "clip", hasAudio: true },
        { id: "other", hasAudio: true },
      ],
      audios: [{ id: "bgm" }, { id: "voice" }],
    };
    const ids = new Set(["bgm", "voice"]);
    pruneMutedBrowserMedia(
      composition,
      [
        { id: "clip", tagName: "video", muted: true },
        { id: "voice", tagName: "audio", muted: true },
        { id: "bgm", tagName: "audio", muted: false },
      ],
      ids,
    );
    expect(composition.audios.map((a) => a.id)).toEqual(["bgm"]);
    expect(ids.has("voice")).toBe(false);
    expect(composition.videos.find((v) => v.id === "clip")?.hasAudio).toBe(false);
    expect(composition.videos.find((v) => v.id === "other")?.hasAudio).toBe(true);
  });

  it("is a no-op when nothing is muted", () => {
    const composition = { videos: [{ id: "v", hasAudio: true }], audios: [{ id: "a" }] };
    pruneMutedBrowserMedia(composition, [
      { id: "v", tagName: "video", muted: false },
      { id: "a", tagName: "audio" },
    ]);
    expect(composition.audios.length).toBe(1);
    expect(composition.videos[0]?.hasAudio).toBe(true);
  });
});

describe("a muted video's sound in the mix", () => {
  const html = `<div data-composition-id="root" data-start="0" data-duration="4">
    <video id="quiet" src="quiet.mp4" data-start="0" data-duration="4" data-has-audio="true" data-volume="0.72" muted></video>
    <video id="voice" src="voice.mp4" data-start="0" data-duration="4" data-has-audio="true" data-volume="0.5"></video>
    <audio id="music" src="music.mp3" data-start="0" data-duration="4" data-volume="0.19"></audio>
  </div>`;
  // Both files carry an audio stream, so the auto-detect fallback would add any video the parsers miss.
  const extracted = ["quiet", "voice"].map((videoId) => ({
    videoId,
    metadata: { hasAudio: true },
  }));

  for (const probed of [false, true]) {
    it(`stays out of the mix ${probed ? "after" : "without"} the browser probe`, () => {
      const composition = collectRenderMedia(html);
      if (probed) {
        pruneMutedBrowserMedia(composition, [
          { id: "quiet", tagName: "video", muted: true },
          { id: "voice", tagName: "video", muted: false },
          { id: "music", tagName: "audio", muted: false },
        ]);
      }
      appendAutoDetectedVideoAudio(
        composition,
        extracted as unknown as Parameters<typeof appendAutoDetectedVideoAudio>[1],
      );

      expect(composition.audios.map(({ id, volume }) => [id, volume])).toEqual([
        ["music", 0.19],
        ["voice-audio", 0.5],
      ]);
    });
  }
});
