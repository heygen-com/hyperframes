import { describe, expect, it } from "vitest";
import { audioPillFlags, isLinkedVideoAudio } from "./audioClipLink";

const audio = { id: "bed", tag: "audio", src: "assets/City Ride.mp4?v=2" };

describe("isLinkedVideoAudio", () => {
  it("links an audio pill to a video of the same file", () => {
    expect(
      isLinkedVideoAudio(audio, [
        audio,
        { id: "picture", tag: "video", src: "/preview/assets/city ride.mp4" },
      ]),
    ).toBe(true);
  });

  it("greys a hidden clip and a muted group without dropping the link", () => {
    expect(audioPillFlags({ ...audio, hidden: true }, [])).toEqual({
      muted: true,
      linked: false,
    });
    expect(audioPillFlags({ ...audio, audioGroupHidden: true }, [])).toEqual({
      muted: true,
      linked: false,
    });
  });

  it("leaves a standalone audio file unlinked", () => {
    expect(
      isLinkedVideoAudio({ id: "vo", tag: "audio", src: "assets/voice.wav" }, [
        { id: "picture", tag: "video", src: "assets/city.mp4" },
      ]),
    ).toBe(false);
  });
});
