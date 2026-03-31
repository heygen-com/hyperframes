import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadTranscript, detectFormat, patchCaptionHtml } from "./normalize.js";

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
    expect(words[0]!.text).toBe("Hello");
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
      { text: "Hello world", start: 1.0, end: 3.5 },
      { text: "How are you", start: 4.0, end: 6.0 },
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
      { text: "Hello world", start: 1.0, end: 3.5 },
      { text: "How are you", start: 4.0, end: 6.0 },
    ]);
  });

  it("parses VTT with short timestamps (MM:SS.mmm)", () => {
    const vtt = `WEBVTT

01:23.456 --> 02:00.000
Short format
`;
    const path = tmpFile("short.vtt", vtt);
    const { words } = loadTranscript(path);
    expect(words[0]!.start).toBeCloseTo(83.456, 2);
    expect(words[0]!.end).toBe(120.0);
  });

  it("strips HTML tags from SRT/VTT", () => {
    const srt = `1
00:00:01,000 --> 00:00:03,000
<b>Bold</b> and <i>italic</i>
`;
    const path = tmpFile("tags.srt", srt);
    const { words } = loadTranscript(path);
    expect(words[0]!.text).toBe("Bold and italic");
  });

  it("passes through normalized word arrays", () => {
    const input = [
      { text: "Hello", start: 0.0, end: 0.5 },
      { text: "world", start: 0.6, end: 1.2 },
    ];
    const path = tmpFile("normalized.json", JSON.stringify(input));
    const { words, format } = loadTranscript(path);
    expect(format).toBe("words-json");
    expect(words).toEqual(input);
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
