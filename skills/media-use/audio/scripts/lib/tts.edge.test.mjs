import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  edgeAvailable,
  parseEdgeVtt,
  pickProvider,
  resolveVoiceId,
  synthesizeOne,
  withWordIds,
} from "./tts.mjs";

const FIXTURE_VTT = [
  "WEBVTT",
  "",
  "00:00:00.100 --> 00:00:00.520",
  "Attestation",
  "",
  "00:00:00.530 --> 00:00:00.900",
  "receipts",
  "",
].join("\n");

test("edgeAvailable probes edge-tts --version", () => {
  const calls = [];
  assert.equal(
    edgeAvailable((cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return { status: 0 };
    }),
    true,
  );
  assert.deepEqual(calls, [{ cmd: "edge-tts", args: ["--version"], opts: { stdio: "ignore" } }]);
});

test("pickProvider accepts explicit edge and appends it after unavailable Kokoro", () => {
  const unavailable = {
    heygenAvailable: () => false,
    elevenlabsAvailable: () => false,
    kokoroAvailable: () => false,
    edgeAvailable: () => true,
  };
  assert.equal(pickProvider("edge", unavailable), "edge");
  assert.equal(pickProvider(null, unavailable), "edge");
  assert.equal(pickProvider(null, { ...unavailable, kokoroAvailable: () => true }), "kokoro");
});

test("resolveVoiceId uses the Edge house narrator and preserves explicit voices", async () => {
  assert.equal(await resolveVoiceId({ provider: "edge" }), "en-US-AndrewNeural");
  assert.equal(
    await resolveVoiceId({ provider: "edge", userVoice: "en-US-AvaNeural" }),
    "en-US-AvaNeural",
  );
});

test("parseEdgeVtt converts WordBoundary cues to caption-compatible words", () => {
  assert.deepEqual(withWordIds(parseEdgeVtt(FIXTURE_VTT)), [
    { id: "w0", text: "Attestation", start: 0.1, end: 0.52 },
    { id: "w1", text: "receipts", start: 0.53, end: 0.9 },
  ]);
});

test("synthesizeOne(edge) uses a fake edge-tts CLI and returns native timings", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tts-edge-fake-"));
  const bin = join(dir, "bin");
  const wavAbs = join(dir, "assets", "voice", "line.wav");
  const argsFile = join(dir, "edge.args");
  const originalPath = process.env.PATH;
  const originalArgsFile = process.env.EDGE_ARGS_FILE;
  try {
    mkdirSync(bin);
    writeFileSync(
      join(bin, "edge-tts"),
      [
        "#!/bin/sh",
        'printf \'%s\\n\' "$@" > "$EDGE_ARGS_FILE"',
        'while [ "$#" -gt 0 ]; do',
        '  case "$1" in',
        '    --write-media) media="$2"; shift 2 ;;',
        '    --write-subtitles) subtitles="$2"; shift 2 ;;',
        "    *) shift ;;",
        "  esac",
        "done",
        "printf 'fake mp3' > \"$media\"",
        "printf 'WEBVTT\\n\\n00:00:00.100 --> 00:00:00.520\\nAttestation\\n' > \"$subtitles\"",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(bin, "ffmpeg"),
      [
        "#!/bin/sh",
        'for arg in "$@"; do output="$arg"; done',
        "printf 'fake wav' > \"$output\"",
        "",
      ].join("\n"),
    );
    writeFileSync(join(bin, "ffprobe"), "#!/bin/sh\nprintf '0.520\\n'\n");
    chmodSync(join(bin, "edge-tts"), 0o755);
    chmodSync(join(bin, "ffmpeg"), 0o755);
    chmodSync(join(bin, "ffprobe"), 0o755);
    process.env.PATH = bin;
    process.env.EDGE_ARGS_FILE = argsFile;

    const result = await synthesizeOne({
      provider: "edge",
      text: "Attestation",
      voiceId: "en-US-AndrewNeural",
      wavAbs,
      hyperframesDir: dir,
    });

    assert.deepEqual(result, {
      ok: true,
      words: [{ text: "Attestation", start: 0.1, end: 0.52 }],
    });
    assert.ok(existsSync(wavAbs));
    const args = readFileSync(argsFile, "utf8").trim().split("\n");
    assert.deepEqual(args.slice(0, 6), [
      "--voice",
      "en-US-AndrewNeural",
      "--rate=-2%",
      "--text",
      "Attestation",
      "--write-media",
    ]);
    assert.match(args[6], /voice\.mp3$/);
    assert.equal(args[7], "--write-subtitles");
    assert.match(args[8], /words\.vtt$/);
  } finally {
    process.env.PATH = originalPath;
    if (originalArgsFile === undefined) delete process.env.EDGE_ARGS_FILE;
    else process.env.EDGE_ARGS_FILE = originalArgsFile;
    rmSync(dir, { recursive: true, force: true });
  }
});
