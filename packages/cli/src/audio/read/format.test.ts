import { describe, expect, it } from "vitest";
import { formatRead } from "./format.js";
import { READ_VERSION, type ReadAudio } from "./types.js";

function read(voiceLufs: number, musicLufs: number): ReadAudio {
  return {
    version: READ_VERSION,
    file: "talk.wav",
    sha256: "",
    duration: 4,
    separation: "stems",
    stems: [],
    transcript: null,
    voice: {
      source: "transcript",
      unit: "words",
      sentences: [
        {
          start: 0,
          end: 2,
          text: "Over the bed.",
          rate: null,
          pitchHz: null,
          ending: null,
          againstMusic: { voiceLufs, musicLufs },
        },
      ],
      pauses: [],
      meanRate: null,
      medianPitchHz: null,
    },
    effects: null,
    music: null,
    ambience: null,
    warnings: [],
  };
}

describe("formatRead", () => {
  it.each([
    [-24, -20, "voice -24 LUFS, music -20 LUFS: music 4 dB over voice"],
    [-14, -18, "voice -14 LUFS, music -18 LUFS: voice 4 dB over music"],
    [-18.2, -18.6, "voice -18 LUFS, music -19 LUFS: level with each other"],
    [-24.4, -19.6, "voice -24 LUFS, music -20 LUFS: music 4 dB over voice"],
  ])("says which of voice %s and music %s LUFS is louder", (voice, music, line) => {
    expect(formatRead(read(voice, music))).toContain(line);
  });
});
