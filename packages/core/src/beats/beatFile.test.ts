import { describe, expect, it } from "vitest";
import { findMusicAudioSrc } from "./beatFile";

describe("findMusicAudioSrc", () => {
  it("finds a video with sound tagged as music", () => {
    const html = `<video id="clip" src="band.mp4" data-has-audio="true" data-timeline-role="music"></video>`;
    expect(findMusicAudioSrc(html)).toBe("band.mp4");
  });

  it("finds an audible video by a music id", () => {
    expect(findMusicAudioSrc(`<video id="soundtrack" src="s.mp4" data-has-audio="true">`)).toBe(
      "s.mp4",
    );
  });

  it("skips a muted video and one without declared sound", () => {
    const html = [
      `<video id="music" src="muted.mp4" data-has-audio="true" muted>`,
      `<video id="bgm" src="undeclared.mp4">`,
      `<audio id="music-bed" src="bed.mp3">`,
    ].join("");
    expect(findMusicAudioSrc(html)).toBe("bed.mp3");
  });

  it("keeps document order across audio and video", () => {
    const html = `<audio id="music" src="first.mp3"></audio><video id="bgm" src="v.mp4" data-has-audio="true">`;
    expect(findMusicAudioSrc(html)).toBe("first.mp3");
  });
});
