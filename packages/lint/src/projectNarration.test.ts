import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lintProject } from "./project.js";
import { narrationTextHash } from "./projectNarration.js";

// Keep project lint tests independent of the host's ffprobe installation.
vi.mock("node:child_process", () => {
  const mocked = { ChildProcess: class {}, execFile: vi.fn(), execSync: vi.fn() };
  return { ...mocked, default: mocked };
});

let dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

interface Line {
  id: string;
  text: string;
  start: number;
  duration: number;
  words: Array<{ text: string; start: number; end: number }>;
}

const LINES: Line[] = [
  {
    id: "l1",
    text: "Hello there.",
    start: 0,
    duration: 1.2,
    words: [
      { text: "Hello", start: 0.1, end: 0.4 },
      { text: "there.", start: 0.5, end: 0.9 },
    ],
  },
  {
    id: "l2",
    text: "Forty-seven renewals.",
    start: 2,
    duration: 1.5,
    words: [
      { text: "Forty-seven", start: 0.1, end: 0.7 },
      { text: "renewals.", start: 0.8, end: 1.3 },
    ],
  },
];

interface Options {
  lines?: Line[];
  /** Global caption words; default: every line's words at its clip, tagged with the line. */
  captions?: Array<Record<string, unknown>>;
  clipDuration?: Record<string, number>;
  untagged?: string[];
  manifest?: (manifest: Record<string, unknown>) => unknown;
  captionsInScene?: boolean;
  /** media-use's audio_meta.json with each line's length and words; false leaves it out. */
  audioMeta?: false | ((meta: { voices: Array<Record<string, unknown>> }) => unknown);
}

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

function clipTags(lines: Line[], options: Options): string {
  return lines
    .map((line) => {
      const tag = options.untagged?.includes(line.id) ? "" : ` data-narration-line="${line.id}"`;
      const duration = options.clipDuration?.[line.id] ?? line.duration;
      return `<audio id="vo-${line.id}" src="assets/voice/${line.id}.wav" data-start="${line.start}" data-duration="${duration}" data-track-index="1"${tag}></audio>`;
    })
    .join("\n    ");
}

/** The caption array's words: each line's words at its clip, in the captions' own time base. */
function captionWords(lines: Line[], offset: number) {
  return lines.flatMap((line) =>
    line.words.map((word) => ({
      text: word.text,
      start: line.start + word.start - offset,
      end: line.start + word.end - offset,
      line: line.id,
    })),
  );
}

function manifestLine(line: Line, wav: string) {
  return {
    id: line.id,
    text: line.text,
    audio: `assets/voice/${line.id}.wav`,
    voiced: {
      textHash: narrationTextHash(line.text),
      voiceKey: "kokoro:af_heart:1:en-us",
      audioHash: sha256(wav),
    },
  };
}

const SCENE_HOST = `<div id="caps" data-composition-id="caps" data-composition-src="compositions/captions.html" data-start="2" data-duration="5" data-track-index="3"></div>`;

/** Where the caption array lives: the root's own script, or a scene mounted at 2 s. */
function captionPlacement(options: Options, lines: Line[]) {
  const inScene = options.captionsInScene === true;
  const words = options.captions ?? captionWords(lines, inScene ? 2 : 0);
  const script = `<script>const TRANSCRIPT = ${JSON.stringify(words)};</script>`;
  return inScene
    ? { host: SCENE_HOST, rootScript: "", sceneScript: script, file: "compositions/captions.html" }
    : { host: "", rootScript: script, sceneScript: "", file: "index.html" };
}

function narratedProject(options: Options = {}): string {
  const lines = options.lines ?? LINES;
  const captions = captionPlacement(options, lines);
  const dir = mkdtempSync(join(tmpdir(), "hf-narration-lint-"));
  dirs.push(dir);
  const write = (path: string, content: string | Buffer) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  };
  write(
    "index.html",
    `<!doctype html><html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="10">
    ${clipTags(lines, options)}
    ${captions.host}
  </div>
  ${captions.rootScript}
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`,
  );
  write(
    "compositions/captions.html",
    `<div data-composition-id="caps" data-width="1920" data-height="1080" data-duration="5">${captions.sceneScript}
<script>window.__timelines["caps"] = gsap.timeline({ paused: true });</script></div>`,
  );
  const manifest: Record<string, unknown> = {
    version: 1,
    defaults: { provider: "kokoro", voice: "af_heart", speed: 1, lang: "en-us" },
    captions: { file: captions.file },
    lines: lines.map((line) => {
      const wav = `RIFF${line.id}`;
      write(`assets/voice/${line.id}.wav`, wav);
      return manifestLine(line, wav);
    }),
  };
  const edited = options.manifest ? options.manifest(manifest) : manifest;
  write("narration.json", JSON.stringify(edited, null, 2));
  if (options.audioMeta !== false) {
    const meta = {
      tts_provider: "kokoro",
      voices: lines.map((line) => ({
        id: line.id,
        path: `assets/voice/${line.id}.wav`,
        duration_s: line.duration,
        words: line.words,
      })),
    };
    write("audio_meta.json", JSON.stringify(options.audioMeta ? options.audioMeta(meta) : meta));
  }
  return dir;
}

async function narrationFindings(dir: string) {
  const { results } = await lintProject(dir);
  return results
    .flatMap((entry) => entry.result.findings)
    .filter((finding) => finding.code.startsWith("narration_"))
    .map((finding) => `${finding.severity} ${finding.code}: ${finding.message}`);
}

const editLine =
  (index: number, change: (line: Record<string, unknown>) => void) =>
  (manifest: Record<string, unknown>) => {
    change((manifest.lines as Array<Record<string, unknown>>)[index]!);
    return manifest;
  };

describe("narration lint", () => {
  it("finds nothing without narration.json", async () => {
    const dir = narratedProject();
    rmSync(join(dir, "narration.json"));
    expect(await narrationFindings(dir)).toEqual([]);
  });

  it("finds nothing when clips and captions match the manifest", async () => {
    expect(await narrationFindings(narratedProject())).toEqual([]);
  });

  it("reports a manifest that is not one", async () => {
    const dir = narratedProject({ manifest: () => ({ version: 1, lines: "nope" }) });
    expect(await narrationFindings(dir)).toEqual([
      "warning narration_manifest_invalid: narration.json is not a narration manifest: lines must be an array.",
    ]);
  });

  it("reports a line whose text, voice or WAV changed since it was voiced", async () => {
    const dir = narratedProject({
      manifest: editLine(0, (line) => {
        line.text = "Hi there.";
        line.voice = "bf_emma";
      }),
    });
    writeFileSync(join(dir, "assets/voice/l1.wav"), "RIFF-replaced");
    expect(await narrationFindings(dir)).toContain(
      "warning narration_audio_stale: Narration line l1 needs re-voicing: its text changed, its voice settings changed, its WAV was replaced.",
    );
  });

  it("reports a missing audio file", async () => {
    const dir = narratedProject();
    rmSync(join(dir, "assets/voice/l2.wav"));
    expect(await narrationFindings(dir)).toContain(
      "warning narration_audio_stale: Narration line l2 needs re-voicing: its audio file assets/voice/l2.wav is missing.",
    );
  });

  it("reports a line no clip links, and a clip linked to an unknown line", async () => {
    const dir = narratedProject({
      untagged: ["l2"],
      manifest: editLine(0, (line) => {
        line.id = "intro";
      }),
    });
    const findings = await narrationFindings(dir);
    expect(findings).toContain(
      'warning narration_line_unlinked: assets/voice/l1.wav is linked to narration line "l1", which narration.json does not list.',
    );
    expect(findings).toContain(
      'warning narration_line_unlinked: Narration line intro has no <audio data-narration-line="intro"> on the timeline.',
    );
    expect(findings).toContain(
      'warning narration_line_unlinked: Narration line l2 has no <audio data-narration-line="l2"> on the timeline.',
    );
  });

  it("reports a clip whose length drifted past 0.05 s, and not one within it", async () => {
    expect(await narrationFindings(narratedProject({ clipDuration: { l1: 1.24 } }))).toEqual([]);
    expect(await narrationFindings(narratedProject({ clipDuration: { l1: 1.5 } }))).toEqual([
      "warning narration_clip_timing_mismatch: Narration line l1 lasts 1.2s, but its clip plays for 1.5s.",
    ]);
  });

  it("reports captions that no longer match the voice", async () => {
    const shifted = narratedProject({
      captions: [
        { text: "Hello", start: 0.1, end: 0.4, line: "l1" },
        { text: "there.", start: 0.8, end: 1.1, line: "l1" },
        { text: "Forty-seven", start: 2.1, end: 2.7, line: "l2" },
        { text: "renewals.", start: 2.8, end: 3.3, line: "l2" },
      ],
    });
    expect(await narrationFindings(shifted)).toEqual([
      'warning narration_captions_out_of_sync: Narration line l1: caption word "there." starts at 0.8s, but the voice says it at 0.5s.',
    ]);
    const missing = narratedProject({
      captions: [
        { text: "Hello", start: 0.1, end: 0.4, line: "l1" },
        { text: "Forty-seven", start: 2.1, end: 2.7, line: "l2" },
        { text: "renewals.", start: 2.8, end: 3.3, line: "l2" },
      ],
    });
    expect(await narrationFindings(missing)).toEqual([
      "warning narration_captions_out_of_sync: Narration line l1: 1 caption words show it, but its voice has 2.",
    ]);
  });

  it("without audio_meta.json, skips the length and only needs captions inside their clip", async () => {
    const inside = narratedProject({ audioMeta: false, clipDuration: { l1: 1.5 } });
    expect(await narrationFindings(inside)).toEqual([]);
    const outside = narratedProject({
      audioMeta: false,
      captions: [
        { text: "Hello", start: 0.1, end: 0.4, line: "l1" },
        { text: "there.", start: 1.6, end: 1.9, line: "l1" },
        { text: "Forty-seven", start: 2.1, end: 2.7, line: "l2" },
        { text: "renewals.", start: 2.8, end: 3.3, line: "l2" },
      ],
    });
    expect(await narrationFindings(outside)).toEqual([
      'warning narration_captions_out_of_sync: Narration line l1: caption word "there." starts at 1.6s, outside its clip (0s to 1.2s).',
    ]);
  });

  it("ignores an audio_meta.json voice that describes another file", async () => {
    const dir = narratedProject({
      clipDuration: { l1: 1.5 },
      audioMeta: (meta) => {
        meta.voices[0]!.path = "assets/voice/l1-old.wav";
        return meta;
      },
    });
    expect(await narrationFindings(dir)).toEqual([]);
  });

  it("falls back to untagged words inside the clip", async () => {
    const untagged = LINES.flatMap((line) =>
      line.words.map((word) => ({
        text: word.text,
        start: line.start + word.start,
        end: line.start + word.end,
      })),
    );
    expect(await narrationFindings(narratedProject({ captions: untagged }))).toEqual([]);
  });

  it("places captions in a mounted scene at the scene's start", async () => {
    expect(await narrationFindings(narratedProject({ captionsInScene: true }))).toEqual([]);
  });

  it("notes captions that read differently from the script, as info only", async () => {
    const dir = narratedProject({
      captions: [
        { text: "Hello", start: 0.1, end: 0.4, line: "l1" },
        { text: "there.", start: 0.5, end: 0.9, line: "l1" },
        { text: "47", start: 2.1, end: 2.7, line: "l2" },
        { text: "renewals.", start: 2.8, end: 3.3, line: "l2" },
      ],
    });
    expect(await narrationFindings(dir)).toEqual([
      'info narration_transcript_mismatch: Narration line l2 says "Forty-seven renewals.", but its captions read "47 renewals.".',
    ]);
  });
});
