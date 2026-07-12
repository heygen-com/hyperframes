import { describe, expect, it } from "bun:test";
import { pruneMutedBrowserMedia } from "./probeStage.js";

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
