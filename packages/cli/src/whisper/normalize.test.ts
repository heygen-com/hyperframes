import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadTranscript, detectFormat, patchCaptionHtml, stripBeforeOnset } from "./normalize.js";
import { detectSpeechOnset } from "./transcribe.js";

function tmpFile(name: string, content: string): string {
  const dir = join(tmpdir(), `hf-normalize-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  dirs.push(dir);
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

let dirs: string[] = [];

afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

describe("detectFormat", () => {
  it("detects SRT by extension", () => {
    const path = tmpFile("test.srt", "1\n00:00:01,000 --> 00:00:02,000\nHello\n");
    expect(detectFormat(path)).toBe("srt");
  });

  it("detects VTT by extension", () => {
    const path = tmpFile("test.vtt", "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n");
    expect(detectFormat(path)).toBe("vtt");
  });

  it("detects whisper-cpp JSON", () => {
    const path = tmpFile(
      "transcript.json",
      JSON.stringify({
        transcription: [
          {
            offsets: { from: 0, to: 2000 },
            text: " Hello world.",
            tokens: [
              { text: " Hello", offsets: { from: 0, to: 1000 }, p: 0.98 },
              { text: " world", offsets: { from: 1000, to: 2000 }, p: 0.95 },
            ],
          },
        ],
      }),
    );
    expect(detectFormat(path)).toBe("whisper-cpp");
  });

  it("detects OpenAI JSON", () => {
    const path = tmpFile(
      "openai.json",
      JSON.stringify({
        words: [
          { word: "Hello", start: 0.0, end: 0.5 },
          { word: "world", start: 0.6, end: 1.2 },
        ],
      }),
    );
    expect(detectFormat(path)).toBe("openai");
  });

  it("detects normalized word array", () => {
    const path = tmpFile(
      "words.json",
      JSON.stringify([
        { text: "Hello", start: 0.0, end: 0.5 },
        { text: "world", start: 0.6, end: 1.2 },
      ]),
    );
    expect(detectFormat(path)).toBe("words-json");
  });
});

describe("loadTranscript", () => {
  it("parses whisper-cpp JSON with punctuation merging", () => {
    const path = tmpFile(
      "transcript.json",
      JSON.stringify({
        transcription: [
          {
            tokens: [
              { text: " Hello", offsets: { from: 0, to: 500 } },
              { text: ",", offsets: { from: 500, to: 550 } },
              { text: " world", offsets: { from: 600, to: 1200 } },
              { text: ".", offsets: { from: 1200, to: 1250 } },
            ],
          },
        ],
      }),
    );
    const { words, format } = loadTranscript(path);
    expect(format).toBe("whisper-cpp");
    expect(words).toEqual([
      { text: "Hello,", start: 0, end: 0.55 },
      { text: "world.", start: 0.6, end: 1.25 },
    ]);
  });

  it("filters whisper-cpp non-speech tokens", () => {
    const path = tmpFile(
      "transcript.json",
      JSON.stringify({
        transcription: [
          {
            tokens: [
              { text: "[_BEG_]", offsets: { from: 0, to: 0 } },
              { text: " Hello", offsets: { from: 100, to: 500 } },
              { text: "[BLANK_AUDIO]", offsets: { from: 500, to: 1000 } },
            ],
          },
        ],
      }),
    );
    const { words } = loadTranscript(path);
    expect(words).toHaveLength(1);
    expect(words[0]?.text).toBe("Hello");
  });

  it("parses OpenAI Whisper API response", () => {
    const path = tmpFile(
      "openai.json",
      JSON.stringify({
        text: "Hello world",
        words: [
          { word: "Hello", start: 0.0, end: 0.5 },
          { word: "world", start: 0.6, end: 1.2 },
        ],
      }),
    );
    const { words, format } = loadTranscript(path);
    expect(format).toBe("openai");
    expect(words).toEqual([
      { text: "Hello", start: 0, end: 0.5 },
      { text: "world", start: 0.6, end: 1.2 },
    ]);
  });

  it("parses SRT files", () => {
    const srt = `1
00:00:01,000 --> 00:00:03,500
Hello world

2
00:00:04,000 --> 00:00:06,000
How are you
`;
    const path = tmpFile("captions.srt", srt);
    const { words, format } = loadTranscript(path);
    expect(format).toBe("srt");
    expect(words).toEqual([
      { text: "Hello world", start: 1.0, end: 3.5, id: "w0" },
      { text: "How are you", start: 4.0, end: 6.0, id: "w1" },
    ]);
  });

  it("parses VTT files", () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:03.500
Hello world

00:00:04.000 --> 00:00:06.000
How are you
`;
    const path = tmpFile("captions.vtt", vtt);
    const { words, format } = loadTranscript(path);
    expect(format).toBe("vtt");
    expect(words).toEqual([
      { text: "Hello world", start: 1.0, end: 3.5, id: "w0" },
      { text: "How are you", start: 4.0, end: 6.0, id: "w1" },
    ]);
  });

  it("parses VTT with short timestamps (MM:SS.mmm)", () => {
    const vtt = `WEBVTT

01:23.456 --> 02:00.000
Short format
`;
    const path = tmpFile("short.vtt", vtt);
    const { words } = loadTranscript(path);
    expect(words[0]?.start).toBeCloseTo(83.456, 2);
    expect(words[0]?.end).toBe(120.0);
  });

  it("strips HTML tags from SRT/VTT", () => {
    const srt = `1
00:00:01,000 --> 00:00:03,000
<b>Bold</b> and <i>italic</i>
`;
    const path = tmpFile("tags.srt", srt);
    const { words } = loadTranscript(path);
    expect(words[0]?.text).toBe("Bold and italic");
  });

  it("passes through normalized word arrays", () => {
    const input = [
      { text: "Hello", start: 0.0, end: 0.5 },
      { text: "world", start: 0.6, end: 1.2 },
    ];
    const path = tmpFile("normalized.json", JSON.stringify(input));
    const { words, format } = loadTranscript(path);
    expect(format).toBe("words-json");
    expect(words).toEqual([
      { text: "Hello", start: 0, end: 0.5, id: "" },
      { text: "world", start: 0.6, end: 1.2, id: "" },
    ]);
  });
});

describe("whisper-cpp contraction merging", () => {
  it("merges didn + 't into didn't", () => {
    const path = tmpFile(
      "contractions.json",
      JSON.stringify({
        transcription: [
          {
            tokens: [
              { text: " I", offsets: { from: 0, to: 200 } },
              { text: " didn", offsets: { from: 200, to: 500 } },
              { text: "'t", offsets: { from: 500, to: 700 } },
              { text: " know", offsets: { from: 700, to: 1000 } },
            ],
          },
        ],
      }),
    );
    const { words } = loadTranscript(path);
    expect(words).toEqual([
      { text: "I", start: 0, end: 0.2 },
      { text: "didn't", start: 0.2, end: 0.7 },
      { text: "know", start: 0.7, end: 1 },
    ]);
  });

  it("merges I + 'm into I'm", () => {
    const path = tmpFile(
      "im.json",
      JSON.stringify({
        transcription: [
          {
            tokens: [
              { text: " I", offsets: { from: 0, to: 100 } },
              { text: "'m", offsets: { from: 100, to: 300 } },
              { text: " done", offsets: { from: 300, to: 600 } },
            ],
          },
        ],
      }),
    );
    const { words } = loadTranscript(path);
    expect(words[0]?.text).toBe("I'm");
    expect(words[0]?.end).toBe(0.3);
  });

  it("merges could + 've into could've", () => {
    const path = tmpFile(
      "couldve.json",
      JSON.stringify({
        transcription: [
          {
            tokens: [
              { text: " could", offsets: { from: 0, to: 400 } },
              { text: "'ve", offsets: { from: 400, to: 600 } },
              { text: " been", offsets: { from: 600, to: 900 } },
            ],
          },
        ],
      }),
    );
    const { words } = loadTranscript(path);
    expect(words[0]?.text).toBe("could've");
  });
});

describe("whisper-cpp fragment merging", () => {
  it("merges single capital + lowercase: C + aught -> Caught", () => {
    const path = tmpFile(
      "fragments.json",
      JSON.stringify({
        transcription: [
          {
            tokens: [
              { text: " C", offsets: { from: 0, to: 100 } },
              { text: "aught", offsets: { from: 100, to: 500 } },
              { text: " a", offsets: { from: 500, to: 600 } },
            ],
          },
        ],
      }),
    );
    const { words } = loadTranscript(path);
    expect(words[0]?.text).toBe("Caught");
    expect(words[0]?.end).toBe(0.5);
    expect(words).toHaveLength(2);
  });

  it("merges consonant + in': shin + in' -> shinin'", () => {
    const path = tmpFile(
      "dropg.json",
      JSON.stringify({
        transcription: [
          {
            tokens: [
              { text: " shin", offsets: { from: 0, to: 300 } },
              { text: "in'", offsets: { from: 300, to: 500 } },
            ],
          },
        ],
      }),
    );
    const { words } = loadTranscript(path);
    expect(words).toHaveLength(1);
    expect(words[0]?.text).toBe("shinin'");
  });
});

describe("whisper-cpp zero-duration interpolation", () => {
  it("interpolates a cluster of zero-duration words", () => {
    const path = tmpFile(
      "zerodur.json",
      JSON.stringify({
        transcription: [
          {
            tokens: [
              { text: " hello", offsets: { from: 0, to: 500 } },
              { text: " we", offsets: { from: 1000, to: 1000 } },
              { text: " are", offsets: { from: 1000, to: 1000 } },
              { text: " here", offsets: { from: 1000, to: 1000 } },
              { text: " now", offsets: { from: 1500, to: 2000 } },
            ],
          },
        ],
      }),
    );
    const { words } = loadTranscript(path);
    expect(words).toHaveLength(5);
    // The three zero-duration words should be spread between 0.5 and 1.5
    const we = words[1] ?? { start: 0, end: 0, text: "" };
    const are = words[2] ?? { start: 0, end: 0, text: "" };
    const here = words[3] ?? { start: 0, end: 0, text: "" };
    expect(we.start).toBeCloseTo(0.5, 1);
    expect(we.end).toBeCloseTo(0.833, 1);
    expect(are.start).toBeCloseTo(0.833, 1);
    expect(are.end).toBeCloseTo(1.167, 1);
    expect(here.start).toBeCloseTo(1.167, 1);
    expect(here.end).toBeCloseTo(1.5, 1);
    // Each should have positive duration
    expect(we.end).toBeGreaterThan(we.start);
    expect(are.end).toBeGreaterThan(are.start);
    expect(here.end).toBeGreaterThan(here.start);
  });

  it("handles isolated zero-duration word", () => {
    const path = tmpFile(
      "singlezero.json",
      JSON.stringify({
        transcription: [
          {
            tokens: [
              { text: " hello", offsets: { from: 0, to: 500 } },
              { text: " I", offsets: { from: 800, to: 800 } },
              { text: " know", offsets: { from: 1000, to: 1500 } },
            ],
          },
        ],
      }),
    );
    const { words } = loadTranscript(path);
    const iWord = words[1] ?? { start: 0, end: 0, text: "" };
    expect(iWord.end).toBeGreaterThan(iWord.start);
    expect(iWord.start).toBeCloseTo(0.5, 1);
    expect(iWord.end).toBeCloseTo(1, 1);
  });
});

describe("patchCaptionHtml", () => {
  it("replaces const script = [] in HTML files", () => {
    const dir = join(tmpdir(), `hf-patch-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    dirs.push(dir);

    const html = `<html><body><script>
      const script = [];
      console.log(script);
    </script></body></html>`;
    writeFileSync(join(dir, "captions.html"), html);

    const words = [
      { text: "Hello", start: 1.0, end: 1.5 },
      { text: "world", start: 2.0, end: 2.5 },
    ];
    patchCaptionHtml(dir, words);

    const result = readFileSync(join(dir, "captions.html"), "utf-8");
    expect(result).toContain('"Hello"');
    expect(result).toContain('"world"');
    expect(result).not.toContain("const script = [];");
  });

  it("replaces const TRANSCRIPT = [] variant", () => {
    const dir = join(tmpdir(), `hf-patch-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    dirs.push(dir);

    const html = `<script>const TRANSCRIPT = [];</script>`;
    writeFileSync(join(dir, "index.html"), html);

    patchCaptionHtml(dir, [{ text: "Hi", start: 0, end: 1 }]);

    const result = readFileSync(join(dir, "index.html"), "utf-8");
    expect(result).toContain("const TRANSCRIPT = ");
    expect(result).toContain('"Hi"');
  });

  it("does not modify HTML files without matching script patterns", () => {
    const dir = join(tmpdir(), `hf-patch-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    dirs.push(dir);

    const html = `<html><body><script>console.log("hello");</script></body></html>`;
    writeFileSync(join(dir, "page.html"), html);

    patchCaptionHtml(dir, [{ text: "Hi", start: 0, end: 1 }]);

    const result = readFileSync(join(dir, "page.html"), "utf-8");
    expect(result).toBe(html);
  });

  it("skips empty word arrays", () => {
    const dir = join(tmpdir(), `hf-patch-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    dirs.push(dir);

    const html = `<script>const script = [];</script>`;
    writeFileSync(join(dir, "captions.html"), html);

    patchCaptionHtml(dir, []);

    const result = readFileSync(join(dir, "captions.html"), "utf-8");
    expect(result).toBe(html);
  });
});

describe("detectSpeechOnset", () => {
  function makeSyntheticWav(
    sampleRate: number,
    durationSeconds: number,
    energyFn: (t: number) => number,
  ): string {
    const numSamples = Math.floor(sampleRate * durationSeconds);
    const dataSize = numSamples * 2;
    const buf = Buffer.alloc(44 + dataSize);
    // RIFF header
    buf.write("RIFF", 0);
    buf.writeUInt32LE(36 + dataSize, 4);
    buf.write("WAVE", 8);
    buf.write("fmt ", 12);
    buf.writeUInt32LE(16, 16); // chunk size
    buf.writeUInt16LE(1, 20); // PCM
    buf.writeUInt16LE(1, 22); // mono
    buf.writeUInt32LE(sampleRate, 24);
    buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
    buf.writeUInt16LE(2, 32); // block align
    buf.writeUInt16LE(16, 34); // bits per sample
    buf.write("data", 36);
    buf.writeUInt32LE(dataSize, 40);
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const amplitude = energyFn(t);
      buf.writeInt16LE(Math.round(amplitude * 32767), 44 + i * 2);
    }
    const path = join(tmpdir(), `hf-wav-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}.wav`);
    writeFileSync(path, buf);
    dirs.push(path);
    return path;
  }

  it("detects onset when silence transitions to loud", () => {
    const wavPath = makeSyntheticWav(16000, 15, (t) => (t < 5 ? 0.01 : 0.8));
    const onset = detectSpeechOnset(wavPath);
    expect(onset).not.toBeNull();
    expect(onset!).toBeGreaterThanOrEqual(4);
    expect(onset!).toBeLessThanOrEqual(7);
  });

  it("returns null for consistent energy throughout", () => {
    const wavPath = makeSyntheticWav(16000, 10, () => 0.5);
    const onset = detectSpeechOnset(wavPath);
    expect(onset).toBeNull();
  });

  it("returns null for very short audio", () => {
    const wavPath = makeSyntheticWav(16000, 2, () => 0.5);
    const onset = detectSpeechOnset(wavPath);
    expect(onset).toBeNull();
  });

  it("returns null when onset is too early (< 3s)", () => {
    const wavPath = makeSyntheticWav(16000, 10, (t) => (t < 1 ? 0.01 : 0.8));
    const onset = detectSpeechOnset(wavPath);
    expect(onset).toBeNull();
  });
});

describe("stripBeforeOnset", () => {
  it("removes words before onset time", () => {
    const words = [
      { text: "ghost", start: 0.5, end: 2.0 },
      { text: "alone", start: 3.0, end: 5.0 },
      { text: "Given", start: 19.0, end: 19.5 },
      { text: "the", start: 19.5, end: 20.0 },
    ];
    const result = stripBeforeOnset(words, 18.5);
    expect(result).toHaveLength(2);
    expect(result[0]!.text).toBe("Given");
  });

  it("keeps words within 0.5s tolerance of onset", () => {
    const words = [
      { text: "hello", start: 18.2, end: 18.8 },
      { text: "world", start: 19.0, end: 19.5 },
    ];
    const result = stripBeforeOnset(words, 18.5);
    expect(result).toHaveLength(2);
  });

  it("keeps everything when onset is 0", () => {
    const words = [
      { text: "hello", start: 0.1, end: 0.5 },
      { text: "world", start: 0.6, end: 1.0 },
    ];
    const result = stripBeforeOnset(words, 0);
    expect(result).toHaveLength(2);
  });

  it("returns empty array when all words are before onset", () => {
    const words = [
      { text: "ghost", start: 0.5, end: 2.0 },
      { text: "alone", start: 3.0, end: 5.0 },
    ];
    const result = stripBeforeOnset(words, 20.0);
    expect(result).toHaveLength(0);
  });
});
