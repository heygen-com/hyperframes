import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { localTtsGenerate } from "./tts-local-provider.mjs";

// Kokoro runs `hyperframes tts` through the CLI that started the engine (HYPERFRAMES_CLI_ENTRY),
// with the same Node and no shell, on every platform. Without that hand-over it never resolves
// `hyperframes` through npx from the project; it falls through to the next provider.

const envWithNpxCli = {
  npm_execpath: "C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js",
  npm_node_execpath: "C:/Program Files/nodejs/node.exe",
};
const npxCliPath = "C:/Program Files/nodejs/node_modules/npm/bin/npx-cli.js";
const pathExists = (path) => path === npxCliPath;

test("a launching CLI's entry file runs instead of npx, on every platform", async () => {
  for (const platform of ["darwin", "linux", "win32"]) {
    const captured = [];
    const fakeExec = (cmd, args, opts) => captured.push({ cmd, args, opts });
    const entry = "/opt/hf/dist/cli.js";
    const env = { ...envWithNpxCli, HYPERFRAMES_CLI_ENTRY: entry };

    await localTtsGenerate(
      "hello & there",
      { voice: "am_michael" },
      platform,
      fakeExec,
      env,
      pathExists,
    );

    assert.equal(captured.length, 1);
    assert.equal(captured[0].cmd, process.execPath);
    assert.deepEqual(captured[0].args.slice(0, 3), [entry, "tts", "--text-file"]);
    assert.ok(captured[0].args.includes("--voice"));
    // execFileSync options survive (pipes are what let the caller read the
    // "kokoro-onnx not installed" hint back out).
    assert.deepEqual(captured[0].opts.stdio, ["ignore", "pipe", "pipe"]);
  }
});

test("without an absolute CLI entry: falls through to the next provider (null), no spawn", async () => {
  for (const env of [envWithNpxCli, { ...envWithNpxCli, HYPERFRAMES_CLI_ENTRY: "cli.js" }]) {
    for (const platform of ["darwin", "win32"]) {
      const captured = [];
      const errors = [];
      const originalError = console.error;
      console.error = (message) => errors.push(String(message));
      try {
        const fakeExec = (...call) => captured.push(call);
        assert.equal(await localTtsGenerate("hi", {}, platform, fakeExec, env, pathExists), null);
      } finally {
        console.error = originalError;
      }
      assert.equal(captured.length, 0);
      assert.match(errors.join("\n"), /HYPERFRAMES_CLI_ENTRY/);
    }
  }
});

test("a failed tts run prints its output line by line with control characters escaped", async (t) => {
  const errors = [];
  t.mock.method(console, "error", (message) => errors.push(String(message)));
  const fakeExec = () => {
    const err = new Error("Command failed");
    err.stdout = "";
    err.stderr = "bad text \x1b]0;title\x07\r\nline two \rhello";
    throw err;
  };
  const env = { ...envWithNpxCli, HYPERFRAMES_CLI_ENTRY: "/opt/hf/dist/cli.js" };

  assert.equal(await localTtsGenerate("hello", {}, "darwin", fakeExec, env, pathExists), null);

  assert.deepEqual(errors, [
    "media-use: local voice not enabled (kokoro). bad text \\x1b]0;title\\x07\nline two \\x0dhello",
  ]);
});

test("the line reaches tts in a file of its own, whatever it looks like", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "hf-local-voice-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const notes = join(dir, "notes.txt");
  writeFileSync(notes, "text of the notes file");
  const env = { ...envWithNpxCli, HYPERFRAMES_CLI_ENTRY: "/opt/hf/dist/cli.js" };

  for (const line of [
    notes,
    "\\\\host\\share\\a.txt",
    "//host/share/a.txt",
    "--output=/tmp/x.wav",
    "-v",
  ]) {
    const runs = [];
    const fakeExec = (cmd, args) => {
      const textPath = args[args.indexOf("--text-file") + 1];
      const outPath = args[args.indexOf("--output") + 1];
      runs.push({ args, textPath, outPath, text: readFileSync(textPath, "utf8") });
    };

    await localTtsGenerate(line, {}, "linux", fakeExec, env, pathExists);

    assert.equal(runs.length, 1);
    const [{ args, textPath, outPath, text }] = runs;
    assert.equal(text, line);
    assert.ok(!args.includes(line), `the line is not an argument: ${line}`);
    assert.equal(dirname(textPath), dirname(outPath));
    assert.ok(!existsSync(textPath), "the file goes with the run's folder");
  }
});

test("a line that cannot be written leaves no folder behind", async (t) => {
  const temp = mkdtempSync(join(tmpdir(), "hf-local-voice-test-"));
  const saved = { TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP };
  Object.assign(process.env, { TMPDIR: temp, TEMP: temp, TMP: temp });
  t.after(() => {
    for (const [name, value] of Object.entries(saved))
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    rmSync(temp, { recursive: true, force: true });
  });
  const env = { ...envWithNpxCli, HYPERFRAMES_CLI_ENTRY: "/opt/hf/dist/cli.js" };

  await assert.rejects(localTtsGenerate(undefined, {}, "linux", () => {}, env, pathExists));

  assert.deepEqual(readdirSync(temp), []);
});
