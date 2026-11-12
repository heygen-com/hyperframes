import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ttsUrl = new URL("./tts.mjs", import.meta.url).href;
const stub = `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log("Python 3.12.0");
  process.exit(0);
}
const input = args[2];
const output = args[0] === "-c" ? args[4] : args[args.indexOf("--output") + 1];
const text = fs.readFileSync(input, "utf8");
fs.writeFileSync(output + ".started", input);
const finish = () => {
  if (text === "slow" && !fs.existsSync(process.env.RELEASE_FILE)) {
    setTimeout(finish, 5);
    return;
  }
  const consumed = fs.readFileSync(input, "utf8");
  fs.writeFileSync(output + ".json", JSON.stringify({ input, text, consumed, args }));
  if (process.env.CASE_MODE === "nonzero") process.exit(7);
  if (process.env.CASE_MODE !== "no-output") fs.writeFileSync(output, consumed);
};
setTimeout(finish, 10);
`;

const exercise = `
import assert from "node:assert/strict";
import fs from "node:fs";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { join, dirname } from "node:path";
const { CASE_ROOT: root, CASE_MODE: mode, CASE_PROVIDER: provider } = process.env;
const temp = join(root, "tmp");
const preexisting = join(temp, "hf-txt-preexisting");
fs.mkdirSync(preexisting);
fs.writeFileSync(join(preexisting, "marker"), "keep");
const injected = Object.assign(new Error("synthetic " + mode), { code: "EACCES" });
const originalMkdtemp = fs.mkdtempSync;
const originalWrite = fs.writeFileSync;
const originalRm = fs.rmSync;
if (mode === "allocation") fs.mkdtempSync = (prefix, ...args) => {
  if (prefix.startsWith(join(temp, "hf-txt-"))) throw injected;
  return originalMkdtemp(prefix, ...args);
};
if (mode === "write") fs.writeFileSync = (file, ...args) => {
  if (String(file).endsWith("line.txt")) {
    originalWrite(file, "partial");
    throw injected;
  }
  return originalWrite(file, ...args);
};
if (mode === "spawn-throw") childProcess.spawn = () => { throw injected; };
if (mode === "cleanup") fs.rmSync = (dir, ...args) => {
  if (String(dir).startsWith(join(temp, "hf-txt-"))) throw injected;
  return originalRm(dir, ...args);
};
syncBuiltinESMExports();
const { synthesizeOne } = await import(${JSON.stringify(ttsUrl)});
const project = join(root, "project");
const wavAbs = join(project, "line.wav");
const request = (chosen = provider, text = "synthetic café", output = wavAbs) =>
  synthesizeOne({ provider: chosen, text, voiceId: "synthetic-voice", lang: "es",
    speed: 0.8, wavAbs: output, hyperframesDir: project });
const owned = () => fs.readdirSync(temp).filter(name => name !== "hf-txt-preexisting");
if (["allocation", "write", "spawn-throw"].includes(mode)) {
  await assert.rejects(request(), error => error === injected);
  assert.equal(fs.existsSync(wavAbs), false);
} else if (mode === "concurrent") {
  const slowWav = join(project, "slow.wav");
  const slow = request("elevenlabs", "slow", slowWav);
  try {
    const deadline = Date.now() + 5000;
    while (!fs.existsSync(slowWav + ".started")) {
      assert.ok(Date.now() < deadline, "slow subprocess must start");
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    const slowInput = fs.readFileSync(slowWav + ".started", "utf8");
    assert.deepEqual(await request("kokoro"), { ok: true, words: null });
    assert.deepEqual(owned(), [dirname(slowInput).split(/[\\\\/]/).pop()]);
    assert.equal(fs.readFileSync(slowInput, "utf8"), "slow");
  } finally {
    fs.writeFileSync(process.env.RELEASE_FILE, "release");
    await slow;
  }
  assert.equal(fs.readFileSync(slowWav, "utf8"), "slow");
} else {
  const result = await request();
  const label = provider === "elevenlabs" ? "elevenlabs (python)" : "kokoro (npx hyperframes tts)";
  if (["nonzero", "enoent", "no-output"].includes(mode)) {
    // Kokoro runs the handed-over CLI with this Node, so a missing CLI file exits 1, not ENOENT.
    const missing = provider === "kokoro" ? 1 : -1;
    const error = mode === "no-output" ? label + " produced no wav file" :
      label + " exited with status " + (mode === "enoent" ? missing : 7);
    assert.deepEqual(result, { ok: false, words: null, error });
    assert.equal(fs.existsSync(wavAbs), false);
  } else {
    assert.deepEqual(result, { ok: true, words: null });
    assert.equal(fs.readFileSync(wavAbs, "utf8"), "synthetic café");
  }
  if (mode !== "enoent") {
    const log = JSON.parse(fs.readFileSync(wavAbs + ".json", "utf8"));
    assert.equal(log.text, "synthetic café");
    assert.equal(log.consumed, log.text);
    if (provider === "kokoro") assert.deepEqual(log.args.slice(-4), ["--lang", "es", "--speed", "0.8"]);
  }
}
if (mode === "cleanup") assert.equal(owned().length, 1);
else assert.deepEqual(owned(), [], "owned text directories must be removed");
assert.equal(fs.readFileSync(join(preexisting, "marker"), "utf8"), "keep");
`;

function runCase(provider, mode) {
  const root = mkdtempSync(join(tmpdir(), "tts-cleanup-test-"));
  try {
    for (const dir of ["home", "tmp", "bin", "project"]) mkdirSync(join(root, dir));
    if (mode !== "enoent") {
      const python = join(root, "bin", "python3");
      writeFileSync(python, stub);
      chmodSync(python, 0o755);
      // The handed-over CLI sees `tts <text file> ...`; the shared stub reads npx-style argv.
      writeFileSync(
        join(root, "bin", "cli.cjs"),
        'process.argv.splice(2, 0, "hyperframes");\nrequire("./python3");\n',
      );
    }
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", exercise], {
      encoding: "utf8",
      timeout: 15000,
      env: {
        HOME: join(root, "home"),
        USERPROFILE: join(root, "home"),
        TMPDIR: join(root, "tmp"),
        TMP: join(root, "tmp"),
        TEMP: join(root, "tmp"),
        PATH: join(root, "bin"),
        HYPERFRAMES_CLI_ENTRY: join(root, "bin", "cli.cjs"),
        CASE_ROOT: root,
        CASE_PROVIDER: provider,
        CASE_MODE: mode,
        RELEASE_FILE: join(root, "release"),
      },
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

for (const provider of ["elevenlabs", "kokoro"]) {
  for (const mode of [
    "success",
    "nonzero",
    "no-output",
    "enoent",
    "spawn-throw",
    "allocation",
    "write",
    "cleanup",
  ]) {
    test(
      `synthesizeOne(${provider}) preserves ${mode} behavior and cleans only its text directory`,
      { skip: process.platform === "win32" },
      () => runCase(provider, mode),
    );
  }
}

test(
  "concurrent providers retain each other's text until their subprocess finishes",
  { skip: process.platform === "win32" },
  () => runCase("kokoro", "concurrent"),
);
