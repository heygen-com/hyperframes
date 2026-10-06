import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// A stub CLI answers as `transcribe --json` does when --engine auto ran Parakeet.
const STUB_CLI = `
const fs = require("fs"), path = require("path");
const project = process.argv[process.argv.indexOf("-d") + 1];
const transcriptPath = path.join(project, "cli-words.json");
fs.writeFileSync(transcriptPath, JSON.stringify([{ text: "hello", start: 0.1, end: 0.5 }]));
console.log(JSON.stringify({ ok: true, engine: "parakeet", model: "parakeet-tdt-0.6b-v3", transcriptPath }));
`;

test("the CLI fallback labels the transcript with the engine the CLI ran", () => {
  const root = mkdtempSync(join(tmpdir(), "embedded-captions-transcribe-"));
  try {
    const cliDir = join(root, "hf", "packages", "cli", "dist");
    mkdirSync(cliDir, { recursive: true });
    writeFileSync(join(cliDir, "cli.js"), STUB_CLI);
    const project = join(root, "project");
    mkdirSync(project);
    writeFileSync(join(project, "source.mp4"), "");
    writeFileSync(join(project, "audio.mp3"), "");
    execFileSync(
      process.execPath,
      [fileURLToPath(new URL("./transcribe.cjs", import.meta.url)), project],
      {
        stdio: "ignore",
        env: { ...process.env, HYPERFRAMES_ROOT: join(root, "hf"), TRANSCRIBE_ENGINE: "whisper" },
      },
    );
    const transcript = JSON.parse(readFileSync(join(project, "transcript.json"), "utf8"));
    assert.equal(transcript.engine, "parakeet(parakeet-tdt-0.6b-v3)");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the extracted audio scratch file does not outlive the run", () => {
  const root = mkdtempSync(join(tmpdir(), "embedded-captions-transcribe-"));
  try {
    const cliDir = join(root, "hf", "packages", "cli", "dist");
    mkdirSync(cliDir, { recursive: true });
    writeFileSync(join(cliDir, "cli.js"), STUB_CLI);
    const project = join(root, "project");
    mkdirSync(project);
    execFileSync(
      "ffmpeg",
      ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", join(project, "source.mp4")],
      { stdio: "ignore" },
    );
    execFileSync(
      process.execPath,
      [fileURLToPath(new URL("./transcribe.cjs", import.meta.url)), project],
      {
        stdio: "ignore",
        env: { ...process.env, HYPERFRAMES_ROOT: join(root, "hf"), TRANSCRIBE_ENGINE: "whisper" },
      },
    );
    assert.equal(existsSync(join(project, "audio.mp3")), false);
    assert.equal(existsSync(join(project, "transcript.json")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
