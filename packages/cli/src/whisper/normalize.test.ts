import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Window } from "happy-dom";
import {
  loadTranscript,
  detectFormat,
  patchCaptionHtml,
  formatSrt,
  formatVtt,
  wordsToCues,
} from "./normalize.js";
import { detectSpeechOnset } from "./transcribe.js";

function tmpFile(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-normalize-test-"));
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
  it.each([
    ["00:00:01.000", "00:00:03.500", "align:start"],
    ["00:01.000", "00:03.500", "align:start"],
    ["00:00:01.000", "00:00:03.500", "line:90% position:50%,center size:80% align:center"],
    ["00:01.000", "00:03.500", "\tvertical:rl\tline:0"],
    ["00:00:01.000", "00:00:03.500", "region:captions"],
  ])("retains VTT end time before cue settings: %s --> %s %s", (start, end, settings) => {
    const source = `WEBVTT\n\nfirst\n${start} --> ${end} ${settings}\nFirst phrase\n\nsecond\n00:04.000 --> 00:06.000\nSecond phrase\n`;
    const { words } = loadTranscript(tmpFile("settings.vtt", source));
    expect(words).toEqual([
      { text: "First phrase", start: 1, end: 3.5, id: "w0" },
      { text: "Second phrase", start: 4, end: 6, id: "w1" },
    ]);
    expect(formatSrt(words, { preGrouped: true })).toBe(
      "1\n00:00:01,000 --> 00:00:03,500\nFirst phrase\n\n2\n00:00:04,000 --> 00:00:06,000\nSecond phrase\n",
    );
  });

  it("reads an empty word list as a transcript with no words", () => {
    expect(loadTranscript(tmpFile("transcript.json", "[]"))).toEqual({
      words: [],
      format: "words-json",
    });
  });

  it("still rejects a JSON array that is not a word list", () => {
    expect(() => loadTranscript(tmpFile("transcript.json", '[{"foo":1}]'))).toThrow(
      /Unrecognized JSON transcript format/,
    );
  });

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
      { text: "Hello,", start: 0, end: 0.55, id: "w0" },
      { text: "world.", start: 0.6, end: 1.25, id: "w1" },
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
      { text: "Hello", start: 0, end: 0.5, id: "w0" },
      { text: "world", start: 0.6, end: 1.2, id: "w1" },
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

  it.each([
    ["ALICE: Hello there", "ALICE: Hello there"],
    ["ALICE: Hello\nBOB: Welcome", "ALICE: Hello BOB: Welcome"],
    ["Hello there\nALICE: Welcome", "Hello there ALICE: Welcome"],
    ["ALICE: Hello\nWelcome back", "ALICE: Hello Welcome back"],
    ["HOST-NAME: Welcome", "HOST-NAME: Welcome"],
    ["Alice: Hello there", "Alice: Hello there"],
  ])("preserves the VTT cue payload %j", (payload, text) => {
    const vtt = `WEBVTT\nX-TIMESTAMP-MAP:LOCAL:00:00:00.000,MPEGTS:900000\n\n00:00:01.000 --> 00:00:03.500\n${payload}\n\n00:00:04.000 --> 00:00:06.000\nHow are you\n`;
    const { words } = loadTranscript(tmpFile("speaker.vtt", vtt));
    expect(words).toEqual([
      { text, start: 1, end: 3.5, id: "w0" },
      { text: "How are you", start: 4, end: 6, id: "w1" },
    ]);
    expect(loadTranscript(tmpFile("speaker-roundtrip.vtt", formatVtt(words))).words).toEqual(words);
    expect(loadTranscript(tmpFile("speaker-roundtrip.srt", formatSrt(words))).words).toEqual(words);
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

  it("assigns w{index} ids to normalized word arrays", () => {
    const input = [
      { text: "Hello", start: 0.0, end: 0.5 },
      { text: "world", start: 0.6, end: 1.2 },
    ];
    const path = tmpFile("normalized.json", JSON.stringify(input));
    const { words, format } = loadTranscript(path);
    expect(format).toBe("words-json");
    expect(words).toEqual([
      { text: "Hello", start: 0, end: 0.5, id: "w0" },
      { text: "world", start: 0.6, end: 1.2, id: "w1" },
    ]);
  });

  it("preserves existing ids and repairs empty-string ids from legacy files", () => {
    const input = [
      { text: "Hello", start: 0.0, end: 0.5, id: "keep-me" },
      { text: "world", start: 0.6, end: 1.2, id: "" },
      { text: "again", start: 1.3, end: 1.8 },
    ];
    const path = tmpFile("legacy.json", JSON.stringify(input));
    const { words } = loadTranscript(path);
    expect(words.map((w) => w.id)).toEqual(["keep-me", "w1", "w2"]);
  });
});

describe("subtitle line endings", () => {
  it.each([
    ["srt", "\r\n"],
    ["srt", "\r"],
    ["vtt", "\r\n"],
    ["vtt", "\r"],
  ])("keeps separate %s cues with %j line endings", (ext, newline) => {
    const timestamp = ext === "srt" ? "," : ".";
    const lines = [
      ...(ext === "vtt" ? ["WEBVTT", ""] : []),
      "1",
      `00:00:01${timestamp}000 --> 00:00:03${timestamp}500`,
      "<b>Hello</b> world",
      "Again",
      "",
      "2",
      `00:00:04${timestamp}000 --> 00:00:06${timestamp}000`,
      "How are you",
      "",
    ];
    const { words, format } = loadTranscript(tmpFile(`captions.${ext}`, lines.join(newline)));
    expect(format).toBe(ext);
    expect(words).toEqual([
      { text: "Hello world Again", start: 1, end: 3.5, id: "w0" },
      { text: "How are you", start: 4, end: 6, id: "w1" },
    ]);
    expect(formatSrt(words, { preGrouped: true })).toBe(
      "1\n00:00:01,000 --> 00:00:03,500\nHello world Again\n\n2\n00:00:04,000 --> 00:00:06,000\nHow are you\n",
    );
  });

  it("preserves WebVTT cues when newline forms are mixed", () => {
    const source =
      "WEBVTT\r\n\r\n00:01.000 --> 00:02.000\rFirst phrase\r\r00:03.000 --> 00:04.000\nSecond phrase\n";
    expect(loadTranscript(tmpFile("mixed.vtt", source)).words).toEqual([
      { text: "First phrase", start: 1, end: 2, id: "w0" },
      { text: "Second phrase", start: 3, end: 4, id: "w1" },
    ]);
  });
});

describe("caption formatting", () => {
  it.each([
    ["R&D <config> next", "R&amp;D &lt;config&gt; next"],
    ["Literal &lt; &amp; references", "Literal &amp;lt; &amp;amp; references"],
    ["3 < 4 and 5 > 2", "3 &lt; 4 and 5 &gt; 2"],
    ["R&D --> next", "R&amp;D --&gt; next"],
  ])("preserves literal WebVTT text %j on export and reimport", (text, payload) => {
    const words = [{ text, start: 1, end: 2, id: "w0" }];
    const output = formatVtt(words);
    expect(output).toBe(`WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n${payload}\n`);
    expect(loadTranscript(tmpFile("literal.vtt", output)).words).toEqual(words);
  });

  it.each([
    ["R&amp;D &lt;config&gt; next", "R&D <config> next"],
    ["&quot;quoted&quot; &apos;text&apos;", "\"quoted\" 'text'"],
    ["&#38; &#x3c; &#60;", "& < <"],
    ["Literal &amp;lt; &amp;amp; references", "Literal &lt; &amp; references"],
    ["<b>R&amp;D</b> &lt;config&gt;", "R&D <config>"],
    ["A&nbsp;B&lrm;&rlm;", "A\u00a0B\u200e\u200f"],
    ["Keep &unknown;", "Keep &unknown;"],
  ])("decodes the WebVTT cue payload %j once", (payload, text) => {
    const input = `WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n${payload}\n`;
    expect(loadTranscript(tmpFile("entities.vtt", input)).words).toEqual([
      { text, start: 1, end: 2, id: "w0" },
    ]);
  });

  it("round-trips SRT cues through normalized words", () => {
    const srt = `1
00:00:01,000 --> 00:00:03,500
Write HTML.

2
00:00:03,500 --> 00:00:06,000
Render video. Built for agents.
`;
    const path = tmpFile("captions.srt", srt);
    const { words } = loadTranscript(path);

    const output = formatSrt(words);
    expect(output).toBe(srt);

    const reparsed = loadTranscript(tmpFile("roundtrip.srt", output));
    expect(reparsed.words).toEqual(words);
  });

  it("round-trips VTT cues through normalized words", () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:03.500
Write HTML.

00:00:03.500 --> 00:00:06.000
Render video. Built for agents.
`;
    const path = tmpFile("captions.vtt", vtt);
    const { words } = loadTranscript(path);

    const output = formatVtt(words);
    expect(output).toBe(vtt);

    const reparsed = loadTranscript(tmpFile("roundtrip.vtt", output));
    expect(reparsed.words).toEqual(words);
  });

  it("groups word-level transcript entries into readable cues", () => {
    const cues = wordsToCues(
      [
        { text: "Write", start: 0, end: 0.2 },
        { text: "HTML.", start: 0.2, end: 0.5 },
        { text: "Render", start: 0.7, end: 0.9 },
        { text: "video", start: 0.9, end: 1.1 },
        { text: "for", start: 1.1, end: 1.2 },
        { text: "agents.", start: 1.2, end: 1.6 },
        { text: "Fresh", start: 2.5, end: 2.8 },
        { text: "tracks.", start: 3.9, end: 4.1 },
      ],
      { maxChars: 18, maxGap: 0.8 },
    );

    expect(cues).toEqual([
      { text: "Write HTML.", start: 0, end: 0.5 },
      { text: "Render video for", start: 0.7, end: 1.2 },
      { text: "agents.", start: 1.2, end: 1.6 },
      { text: "Fresh", start: 2.5, end: 2.8 },
      { text: "tracks.", start: 3.9, end: 4.1 },
    ]);
  });

  it("joins CJK word-level tokens without inserting spaces", () => {
    const cues = wordsToCues([
      { text: "你", start: 0, end: 0.3 },
      { text: "好", start: 0.3, end: 0.6 },
      { text: "世界", start: 0.6, end: 1.0 },
    ]);
    expect(cues).toEqual([{ text: "你好世界", start: 0, end: 1 }]);
  });

  it("keeps phrase-level CJK entries as separate cues", () => {
    // Chinese has no inter-word spaces, so the whitespace test cannot see
    // that these are phrases; they used to collapse into one cue spanning
    // the whole transcript.
    const cues = wordsToCues([
      { text: "这是第一个句子", start: 0, end: 2 },
      { text: "这是第二个句子", start: 2, end: 4 },
      { text: "这是第三个句子", start: 4, end: 6 },
    ]);
    expect(cues).toHaveLength(3);
    expect(cues[0]).toEqual({
      text: "这是第一个句子",
      start: 0,
      end: 2,
    });
  });

  it("keeps phrase-level Thai entries as separate cues", () => {
    const cues = wordsToCues([
      { text: "สวัสดีครับ", start: 0, end: 2 },
      { text: "ยินดีต้อนรับ", start: 2, end: 4 },
    ]);
    expect(cues).toHaveLength(2);
  });

  it("treats entries at the length threshold as phrases", () => {
    // Four characters is the boundary: at or above it the entries are read as
    // phrase-level cues, below it as word-level tokens.
    const cues = wordsToCues([
      { text: "你好世界", start: 0, end: 2 },
      { text: "谢谢大家", start: 2, end: 4 },
    ]);
    expect(cues).toHaveLength(2);
  });

  it("still groups word-level CJK tokens into cues", () => {
    // The mirror of the case above: short per-token entries are word-level
    // whisper output and must still be joined.
    const cues = wordsToCues([
      { text: "你", start: 0, end: 0.3 },
      { text: "好", start: 0.3, end: 0.6 },
      { text: "世", start: 0.6, end: 0.9 },
      { text: "界", start: 0.9, end: 1.2 },
    ]);
    expect(cues).toEqual([{ text: "你好世界", start: 0, end: 1.2 }]);
  });

  it("preserves single-word cue boundaries when preGrouped", () => {
    // Phrase-level cues without internal whitespace (one-word or CJK captions)
    // must not merge — auto-detection can't see them, so the caller forces it.
    const cues = wordsToCues(
      [
        { text: "Yes", start: 0, end: 1 },
        { text: "No", start: 1, end: 2 },
      ],
      { preGrouped: true },
    );
    expect(cues).toEqual([
      { text: "Yes", start: 0, end: 1 },
      { text: "No", start: 1, end: 2 },
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
      { text: "I", start: 0, end: 0.2, id: "w0" },
      { text: "didn't", start: 0.2, end: 0.7, id: "w1" },
      { text: "know", start: 0.7, end: 1, id: "w2" },
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

describe("whisper-cpp DTW word timing", () => {
  // Tokens from whisper-cli --dtw small.en on whisper.cpp's jfk.wav sample, where speech
  // runs 0.33-2.12, 3.29-3.69, 4.01-4.29 and from 5.41 s.
  const jfk = {
    transcription: [
      {
        tokens: [
          { text: "[_BEG_]", offsets: { from: 0, to: 0 }, t_dtw: -1 },
          { text: " my", offsets: { from: 710, to: 910 }, t_dtw: 120 },
          { text: " fellow", offsets: { from: 910, to: 1530 }, t_dtw: 158 },
          { text: " Americans", offsets: { from: 1530, to: 2100 }, t_dtw: 208 },
          { text: ",", offsets: { from: 2310, to: 3000 }, t_dtw: 348 },
          { text: " ask", offsets: { from: 3290, to: 3650 }, t_dtw: 368 },
          { text: " not", offsets: { from: 4010, to: 4290 }, t_dtw: 430 },
          { text: " what", offsets: { from: 5410, to: 5520 }, t_dtw: 556 },
        ],
      },
    ],
  };

  it("ends each word at its DTW time and starts it no earlier than the word before ends", () => {
    const { words } = loadTranscript(tmpFile("jfk.json", JSON.stringify(jfk)));
    expect(words.map(({ text, start, end }) => [text, start, end])).toEqual([
      ["my", 0.71, 1.2],
      ["fellow", 1.2, 1.58],
      ["Americans,", 1.58, 2.08],
      ["ask", 3.29, 3.68],
      ["not", 4.01, 4.3],
      ["what", 5.41, 5.56],
    ]);
  });

  it("starts a word at the previous word's end when its offset start drifted past its DTW end", () => {
    // From the same clip repeated to 51 s: past the first window, offsets run late.
    const drifted = {
      transcription: [
        {
          tokens: [
            { text: " green", offsets: { from: 7880, to: 8300 }, t_dtw: 828 },
            { text: " forest", offsets: { from: 8800, to: 8970 }, t_dtw: 868 },
          ],
        },
      ],
    };
    const { words } = loadTranscript(tmpFile("drifted.json", JSON.stringify(drifted)));
    expect(words.map(({ start, end }) => [start, end])).toEqual([
      [7.88, 8.28],
      [8.28, 8.68],
    ]);
  });

  it("never inverts a drifted first word or starts the next one before it", () => {
    const drifted = {
      transcription: [
        {
          tokens: [
            { text: " a", offsets: { from: 8800, to: 8970 }, t_dtw: 828 },
            { text: " b", offsets: { from: 8900, to: 9000 }, t_dtw: 868 },
          ],
        },
      ],
    };
    const { words } = loadTranscript(tmpFile("first.json", JSON.stringify(drifted)));
    for (const word of words) expect(word.start).toBeLessThanOrEqual(word.end);
    const starts = words.map((word) => word.start);
    expect(starts).toEqual([...starts].sort((x, y) => x - y));
  });

  it("keeps offset timing for tokens whisper.cpp did not align", () => {
    const unaligned = {
      transcription: [
        {
          tokens: [
            { text: " ask", offsets: { from: 3290, to: 3650 }, t_dtw: -1 },
            { text: " not", offsets: { from: 4010, to: 4290 }, t_dtw: -1 },
          ],
        },
      ],
    };
    const { words } = loadTranscript(tmpFile("unaligned.json", JSON.stringify(unaligned)));
    expect(words.map(({ start, end }) => [start, end])).toEqual([
      [3.29, 3.65],
      [4.01, 4.29],
    ]);
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
  it.each([
    "</ScRiPt><span data-unexpected>caption</span>",
    "</script\t><span data-unexpected>caption</span>",
    "</script/><span data-unexpected>caption</span>",
    "<!--<script>caption",
    "$&",
    "$`",
    "$'",
    "$$",
    'quotes " and \\ and > & \u2028 \u2029 🎥',
  ])("preserves literal caption text in the HTML script: %s", (text) => {
    const dir = mkdtempSync(join(tmpdir(), "hf-patch-test-"));
    dirs.push(dir);
    const file = join(dir, "captions.html");
    const html =
      '<html><body><span id="caption"></span><script>const TRANSCRIPT = [];</script></body></html>';
    writeFileSync(file, html);
    const words = [{ id: `word-${text}`, text, start: 0, end: 1 }];

    patchCaptionHtml(dir, words);

    const template = new Window().document.createElement("template");
    template.innerHTML = readFileSync(file, "utf-8");
    expect(template.content.querySelectorAll("script")).toHaveLength(1);
    expect(template.content.querySelector("[data-unexpected]")).toBeNull();
    const source = template.content.querySelector("script")?.textContent ?? "";
    const json = source.slice("const TRANSCRIPT = ".length, -1);
    expect(JSON.parse(json)).toEqual(words);
  });

  it("replaces const script = [] in HTML files", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-patch-test-"));
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
    const dir = mkdtempSync(join(tmpdir(), "hf-patch-test-"));
    dirs.push(dir);

    const html = `<script>const TRANSCRIPT = [];</script>`;
    writeFileSync(join(dir, "index.html"), html);

    patchCaptionHtml(dir, [{ text: "Hi", start: 0, end: 1 }]);

    const result = readFileSync(join(dir, "index.html"), "utf-8");
    expect(result).toContain("const TRANSCRIPT = ");
    expect(result).toContain('"Hi"');
  });

  it("does not modify HTML files without matching script patterns", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-patch-test-"));
    dirs.push(dir);

    const html = `<html><body><script>console.log("hello");</script></body></html>`;
    writeFileSync(join(dir, "page.html"), html);

    patchCaptionHtml(dir, [{ text: "Hi", start: 0, end: 1 }]);

    const result = readFileSync(join(dir, "page.html"), "utf-8");
    expect(result).toBe(html);
  });

  it("skips empty word arrays", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-patch-test-"));
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
    const dir = mkdtempSync(join(tmpdir(), "hf-wav-test-"));
    dirs.push(dir);
    const path = join(dir, "tone.wav");
    writeFileSync(path, buf);
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
