import { describe, expect, it } from "vitest";
import {
  narrationComparableWords,
  narrationTimingsOf,
  narrationVoiceKey,
  normalizeNarrationText,
  parseNarrationManifest,
  serializeNarrationManifest,
} from "./narration.js";

const manifest = {
  version: 1,
  defaults: { provider: "kokoro", voice: "af_heart", speed: 1, lang: "en-us" },
  captions: { file: "index.html", array: "TRANSCRIPT" },
  lines: [
    {
      id: "l1",
      text: "Hello there.",
      audio: "assets/voice/l1.wav",
      voiced: { textHash: "a", voiceKey: "kokoro:af_heart:1:en-us", audioHash: "b" },
      note: "kept",
    },
  ],
  owner: "someone else's key",
};

describe("parseNarrationManifest", () => {
  it("accepts a manifest and round-trips unknown keys in their order", () => {
    const text = JSON.stringify(manifest, null, 2) + "\n";
    const parsed = parseNarrationManifest(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(serializeNarrationManifest(parsed.manifest)).toBe(text);
    parsed.manifest.lines[0]!.text = "Hi there.";
    const rewritten = JSON.parse(serializeNarrationManifest(parsed.manifest));
    expect(rewritten.owner).toBe("someone else's key");
    expect(rewritten.lines[0].note).toBe("kept");
  });

  it("names every problem", () => {
    const broken = {
      version: 2,
      lines: [
        { id: "l 1", text: 3, audio: "" },
        { id: "l2", text: "x", audio: "a.wav", voiced: { textHash: 1 } },
        { id: "l2", text: "y", audio: "b.wav", speed: "fast" },
      ],
    };
    const parsed = parseNarrationManifest(JSON.stringify(broken));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.problems).toEqual([
      "version must be 1",
      'lines[0].id must be a plain name such as "l2"',
      "lines[0].text must be a string",
      "lines[0].audio must name the line's audio file",
      "lines[1].voiced.textHash must be a string",
      "lines[1].voiced.voiceKey must be a string",
      "lines[1].voiced.audioHash must be a string",
      'lines[2].id "l2" is used twice',
      "lines[2].speed must be a number",
    ]);
  });

  it("reports invalid JSON", () => {
    const parsed = parseNarrationManifest("{");
    expect(parsed.ok).toBe(false);
  });
});

describe("narrationTimingsOf", () => {
  it("reads each voice's length and words from audio_meta.json by line id", () => {
    const meta = {
      tts_provider: "kokoro",
      voices: [
        {
          id: "l1",
          path: "assets/voice/l1.wav",
          duration_s: 1.2,
          words: [
            { text: "Hello", start: 0.1, end: 0.4, score: 0.9 },
            { text: "there.", start: 0.5, end: 0.9 },
            { text: "bad", start: 2, end: 1 },
          ],
        },
        { id: 2, duration_s: 0.8 },
        { id: "no-length", words: [] },
        "not a voice",
      ],
      bgm: null,
    };
    const timings = narrationTimingsOf(JSON.stringify(meta));
    expect([...timings!.keys()]).toEqual(["l1", "2"]);
    expect(timings!.get("l1")).toEqual({
      path: "assets/voice/l1.wav",
      durationSeconds: 1.2,
      words: [
        { text: "Hello", start: 0.1, end: 0.4 },
        { text: "there.", start: 0.5, end: 0.9 },
      ],
    });
    expect(timings!.get("2")).toEqual({ durationSeconds: 0.8, words: [] });
  });

  it("returns null without a voices list or valid JSON", () => {
    expect(narrationTimingsOf("{")).toBeNull();
    expect(narrationTimingsOf('{"bgm": null}')).toBeNull();
    expect(narrationTimingsOf('{"voices": []}')!.size).toBe(0);
  });
});

describe("voice and text helpers", () => {
  it("builds the voice key from the line over the defaults", () => {
    expect(narrationVoiceKey({ voice: "bf_emma" }, manifest.defaults)).toBe(
      "kokoro:bf_emma:1:en-us",
    );
    expect(narrationVoiceKey({})).toBe("kokoro::1:");
  });

  it("normalises whitespace for hashing and compares words without punctuation", () => {
    expect(normalizeNarrationText("  Hello\n  there. ")).toBe("Hello there.");
    expect(narrationComparableWords("Hello, there! It's 47.")).toEqual([
      "hello",
      "there",
      "it's",
      "47",
    ]);
  });
});
