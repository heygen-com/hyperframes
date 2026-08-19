import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveNpxInvocation } from "./npx-sync.mjs";

// Coverage parity with tts-local-provider.test.mjs, for the whisper.cpp
// fallback's call-site shape (transcribe.mjs runWhisper): the same three
// branches, but with the hard-fail contract — no fallback provider exists,
// so an unresolvable npx must throw actionably instead of returning null.

const envWithNpxCli = {
  npm_execpath: "C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js",
  npm_node_execpath: "C:/Program Files/nodejs/node.exe",
};
const npxCliPath = "C:/Program Files/nodejs/node_modules/npm/bin/npx-cli.js";
const pathExists = (path) => path === npxCliPath;

const WHISPER_ARGV = ["hyperframes", "transcribe", "C:\\media\\input.wav", "--dir", "C:\\work"];
const WHISPER_OPTS = { stdio: ["ignore", "pipe", "pipe"], timeout: 1_800_000 };

test("win32: routes the whisper fallback through node + npx-cli, never bare npx", () => {
  const resolved = resolveNpxInvocation(
    WHISPER_ARGV,
    WHISPER_OPTS,
    "win32",
    envWithNpxCli,
    pathExists,
  );

  assert.equal(resolved.cmd, envWithNpxCli.npm_node_execpath);
  assert.equal(resolved.args[0], npxCliPath);
  assert.deepEqual(resolved.args.slice(1, 3), ["hyperframes", "transcribe"]);
  // execFileSync options survive the rerouting (the timeout bounds the
  // whisper build/model download; the pipes surface its errors).
  assert.deepEqual(resolved.opts.stdio, ["ignore", "pipe", "pipe"]);
  assert.equal(resolved.opts.timeout, 1_800_000);
});

test("win32 without a resolvable npx-cli: throws the actionable install hint", () => {
  assert.throws(
    () => resolveNpxInvocation(WHISPER_ARGV, WHISPER_OPTS, "win32", {}, () => false),
    /npx-cli\.js was not found/,
  );
});

test("non-win32: spawns plain npx unchanged", () => {
  const resolved = resolveNpxInvocation(WHISPER_ARGV, WHISPER_OPTS, "darwin", {}, () => false);

  assert.equal(resolved.cmd, "npx");
  assert.deepEqual(resolved.args, WHISPER_ARGV);
});
