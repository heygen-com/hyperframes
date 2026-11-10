import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { atempoChain, parseWords, scaleWords } from "./lib/recording.mjs";

const AUDIO = join(dirname(fileURLToPath(import.meta.url)), "audio.mjs");

test("atempoChain splits speeds outside ffmpeg's 0.5..2 stage range", () => {
  assert.equal(atempoChain(1.5), "atempo=1.5");
  assert.equal(atempoChain(3), "atempo=2,atempo=1.5");
  assert.equal(atempoChain(0.25), "atempo=0.5,atempo=0.5");
});

test("parseWords takes text or word and rejects a missing time", () => {
  assert.deepEqual(parseWords([{ word: "hi", start: 0, end: 1 }]), [
    { text: "hi", start: 0, end: 1 },
  ]);
  assert.equal(parseWords(undefined), null);
  assert.throws(() => parseWords([{ text: "hi", start: 0 }]), /words\[0\]/);
});

test("scaleWords moves words by 1/speed", () => {
  assert.deepEqual(scaleWords([{ text: "a", start: 1, end: 2 }], 2), [
    { text: "a", start: 0.5, end: 1 },
  ]);
});

test("a recording line with malformed words is omitted with the reason, not a crash", () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-rec-"));
  try {
    const make = spawnSync(
      "ffmpeg",
      ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=duration=1", join(dir, "take.wav")],
      { encoding: "utf8" },
    );
    assert.equal(make.status, 0, make.stderr);
    writeFileSync(
      join(dir, "audio_request.json"),
      JSON.stringify({
        lines: [{ id: "01", audio: "take.wav", words: [{ text: "x", start: 0 }] }],
      }),
    );
    const run = spawnSync(
      process.execPath,
      [
        AUDIO,
        "--request",
        join(dir, "audio_request.json"),
        "--hyperframes",
        dir,
        "--out",
        join(dir, "m.json"),
        "--only",
        "tts",
      ],
      { encoding: "utf8", env: { ...process.env, HOME: dir } },
    );
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /line 01: recording failed — omitted \(words\[0\] needs text/);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "m.json"), "utf8")).voices, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A 1 s gap then a 1 s tone is a "word" at 1..2 s. At speed 2 the tone must start at 0.5 s in the
// stretched file, which is where the scaled word says it is.
test("a recording at speed 2: the file is stretched and the words still land on the audio", () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-rec-"));
  try {
    const make = spawnSync(
      "ffmpeg",
      [
        "-y",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=44100:cl=mono",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=1:sample_rate=44100",
        "-filter_complex",
        "[0]atrim=duration=1[s];[s][1]concat=n=2:v=0:a=1",
        join(dir, "take.wav"),
      ],
      { encoding: "utf8" },
    );
    assert.equal(make.status, 0, make.stderr);
    writeFileSync(
      join(dir, "audio_request.json"),
      JSON.stringify({
        speed: 2,
        lines: [{ id: "01", audio: "take.wav", words: [{ text: "tone", start: 1, end: 2 }] }],
      }),
    );
    const run = spawnSync(
      process.execPath,
      [
        AUDIO,
        "--request",
        join(dir, "audio_request.json"),
        "--hyperframes",
        dir,
        "--out",
        join(dir, "audio_meta.json"),
        "--only",
        "tts",
      ],
      { encoding: "utf8", env: { ...process.env, HOME: dir } },
    );
    assert.equal(run.status, 0, run.stderr + run.stdout);
    const meta = JSON.parse(readFileSync(join(dir, "audio_meta.json"), "utf8"));
    const voice = meta.voices[0];
    assert.equal(meta.tts_provider, "recording");
    assert.equal(voice.source, "recording");
    assert.equal(meta.voice_credit, "Voice: your own recording");
    assert.ok(Math.abs(voice.duration_s - 1) < 0.05, `duration ${voice.duration_s}`);
    assert.deepEqual([voice.words[0].start, voice.words[0].end], [0.5, 1]);
    const probe = spawnSync(
      "ffmpeg",
      ["-i", join(dir, voice.path), "-af", "silencedetect=noise=-40dB:d=0.2", "-f", "null", "-"],
      { encoding: "utf8" },
    );
    const silenceEnd = Number(/silence_end: ([\d.]+)/.exec(probe.stderr)?.[1]);
    assert.ok(
      Math.abs(silenceEnd - voice.words[0].start) < 0.08,
      `tone starts at ${silenceEnd}s, word says ${voice.words[0].start}s`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
