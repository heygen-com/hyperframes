import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

// Exercise the actual engine and provider together; only the paid API and
// external audio tools are fixtures. This is not a live synthesis/render test.
test("Gemini engine saves audio, requests transcription, and returns caption metadata", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "hf-gemini-pipeline-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const preload = join(dir, "fetch.mjs");
  writeFileSync(
    preload,
    `
import assert from 'node:assert/strict';
globalThis.fetch = async (url, options) => {
  assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
  const body = JSON.parse(options.body);
  assert.equal(body.model, 'gemini-3.8-flash-lite-tts');
  assert.equal(body.input[0].content[0].annotations[0].style, 'Line direction');
  const bytes = Buffer.alloc(48);
  bytes.write('RIFF'); bytes.write('WAVE', 8);
  return Response.json({status:'completed', steps:[{type:'model_output', content:[
    {type:'audio', mime_type:'audio/wav', data:bytes.toString('base64')}
  ]}]});
};
`,
  );
  writeFileSync(
    join(bin, "npx"),
    `#!${process.execPath}
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
assert.deepEqual(args.slice(0, 3), ['hyperframes', 'transcribe', 'assets/voice/intro.wav']);
assert.ok(fs.existsSync(args[2]));
assert.equal(args[args.indexOf('--model')+1], 'small.en');
fs.writeFileSync(path.join(args[args.indexOf('--dir')+1], 'transcript.json'), JSON.stringify([
 {text:'Hello',start:0.1,end:0.4}, {text:'there.',start:0.5,end:0.9}
]));
`,
    { mode: 0o755 },
  );
  writeFileSync(join(bin, "ffprobe"), "#!/bin/sh\necho 1.25\n", { mode: 0o755 });
  writeFileSync(join(dir, ".env"), "");
  writeFileSync(
    join(dir, "audio_request.json"),
    JSON.stringify({
      provider: "gemini",
      tts_model: "gemini-3.8-flash-lite-tts",
      style: "Global direction",
      lines: [{ id: "intro", text: "Hello there.", style: "Line direction" }],
      bgm: { mode: "none" },
    }),
  );
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      preload,
      new URL("./audio.mjs", import.meta.url).pathname,
      "--hyperframes",
      dir,
      "--only",
      "tts",
    ],
    {
      encoding: "utf8",
      env: { ...process.env, GEMINI_API_KEY: "fixture-key", PATH: `${bin}:${process.env.PATH}` },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const meta = JSON.parse(readFileSync(join(dir, "audio_meta.json"), "utf8"));
  assert.equal(meta.tts_provider, "gemini");
  assert.equal(meta.voice_id, "Kore");
  assert.deepEqual(meta.voices, [
    {
      id: "intro",
      path: "assets/voice/intro.wav",
      duration_s: 1.25,
      words: [
        { id: "w0", text: "Hello", start: 0.1, end: 0.4 },
        { id: "w1", text: "there.", start: 0.5, end: 0.9 },
      ],
    },
  ]);
  assert.equal(meta.total_duration_s, 1.25);
});
