import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { collectAudioClips } from "./audioClips.js";

function doc(html: string): Document {
  return parseHTML(`<html><body>${html}</body></html>`).document as unknown as Document;
}

describe("collectAudioClips", () => {
  it("parses data-start / data-duration / data-media-start / data-volume", () => {
    const document = doc(
      `<audio src="music.mp3" data-start="2.5" data-duration="10" data-media-start="1" data-volume="0.8"></audio>`,
    );
    expect(collectAudioClips(document)).toEqual([
      { src: "music.mp3", start: 2.5, duration: 10, mediaStart: 1, volume: 0.8 },
    ]);
  });

  it("derives duration from data-end", () => {
    const document = doc(`<audio src="voice.mp3" data-start="3" data-end="8"></audio>`);
    expect(collectAudioClips(document)[0]?.duration).toBe(5);
  });

  it("defaults start/mediaStart to 0, volume to 1 and duration to null", () => {
    const document = doc(`<audio src="bed.mp3"></audio>`);
    expect(collectAudioClips(document)).toEqual([
      { src: "bed.mp3", start: 0, duration: null, mediaStart: 0, volume: 1 },
    ]);
  });

  it("includes video elements as audio sources", () => {
    const document = doc(
      `<video src="clip.mp4" data-start="1"></video><audio src="a.mp3"></audio>`,
    );
    expect(collectAudioClips(document).map((clip) => clip.src)).toEqual(["clip.mp4", "a.mp3"]);
  });

  it("skips muted and zero-volume elements", () => {
    const document = doc(
      `<audio src="m.mp3" muted></audio><video src="v.mp4" data-volume="0"></video>`,
    );
    expect(collectAudioClips(document)).toEqual([]);
  });

  it("clamps volume into [0, 1] and negative starts to 0", () => {
    const document = doc(`<audio src="loud.mp3" data-volume="3" data-start="-2"></audio>`);
    expect(collectAudioClips(document)).toEqual([
      { src: "loud.mp3", start: 0, duration: null, mediaStart: 0, volume: 1 },
    ]);
  });

  it("ignores elements without src", () => {
    const document = doc(`<audio data-start="1"></audio>`);
    expect(collectAudioClips(document)).toEqual([]);
  });
});
