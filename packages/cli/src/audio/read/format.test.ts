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
    stemsDir: null,
    voiceFreeMix: null,
    bpm: null,
    description: null,
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

  it("gives the whole, then each stem with where it plays and what it holds, then the effects with their stem", () => {
    const analysis: ReadAudio = {
      ...read(-14, -18),
      bpm: 103,
      stemsDir: ".hyperframes/read-audio/stems/abc/",
      voiceFreeMix: ".hyperframes/read-audio/stems/abc/no-vocals.wav",
      description: {
        overall: "A voice over a ragtime bed.",
        bgmPrompt: "playful ragtime, 103 BPM",
      },
      stems: [
        {
          name: "vocals",
          db: -18,
          spans: [{ start: 0.75, end: 4.5 }],
          description: "A man speaks.",
        },
        { name: "guitar", db: -38, spans: [{ start: 18.5, end: 19.75 }], description: null },
      ],
      effects: {
        events: [
          {
            t: 1.2,
            end: 1.5,
            kind: "effect",
            group: "S1",
            band: "mid",
            attackMs: 80,
            tail: 0.2,
            peakDb: -12,
            riseDb: 8,
            overMusicDb: null,
            count: 1,
            stem: "other",
          },
        ],
        groups: [{ id: "S1", count: 1 }],
        drumHits: 40,
      },
    };
    const text = formatRead(analysis);
    expect(text.split("\n").slice(0, 12)).toEqual([
      "talk.wav · 4.0 s · 103 BPM",
      "overall: A voice over a ragtime bed.",
      "voice-free mix: .hyperframes/read-audio/stems/abc/no-vocals.wav",
      "stems: .hyperframes/read-audio/stems/abc/",
      "",
      "vocals  -18 dB · 0.75–4.5",
      "  A man speaks.",
      "guitar  -38 dB · 18.5–19.75",
      expect.stringMatching(/^\(descriptions are a model listening to each stem/),
      "",
      "bgm prompt: playful ragtime, 103 BPM",
      "",
    ]);
    expect(text).toContain("40 hits of the music's own drums left out");
    expect(text).toContain(
      "effect   (other, S1): mid, attack 80 ms, tail 0.2 s, peak -12 dBFS, +8 dB over what played before",
    );
    expect(text).toContain("effects: 1 in 1 sounds (S1 ×1)");
    expect(text).not.toMatch(/\b(?:click|hit|whoosh|tick|thump|riser|boom|ding)\b/);
  });
});
