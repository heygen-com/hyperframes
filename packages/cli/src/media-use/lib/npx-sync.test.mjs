import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveNpxInvocation } from "./npx-sync.mjs";

// Coverage parity with tts-local-provider.test.mjs, for the whisper.cpp
// fallback's call-site shape (transcribe.mjs runCli), with the hard-fail
// contract: no fallback provider exists, so a missing CLI hand-over throws
// actionably instead of resolving `hyperframes` through npx.

const envWithNpxCli = {
  npm_execpath: "C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js",
  npm_node_execpath: "C:/Program Files/nodejs/node.exe",
};
const npxCliPath = "C:/Program Files/nodejs/node_modules/npm/bin/npx-cli.js";
const pathExists = (path) => path === npxCliPath;

const WHISPER_ARGV = ["hyperframes", "transcribe", "C:\\media\\input.wav", "--dir", "C:\\work"];
const WHISPER_OPTS = { stdio: ["ignore", "pipe", "pipe"], timeout: 1_800_000 };

test("runs the handed-over CLI entry with the same Node, on every platform", () => {
  for (const platform of ["darwin", "win32"]) {
    const env = { ...envWithNpxCli, HYPERFRAMES_CLI_ENTRY: "/opt/hf/bin/hyperframes.mjs" };
    const resolved = resolveNpxInvocation(WHISPER_ARGV, WHISPER_OPTS, platform, env, pathExists);

    assert.equal(resolved.cmd, process.execPath);
    assert.deepEqual(resolved.args, ["/opt/hf/bin/hyperframes.mjs", ...WHISPER_ARGV.slice(1)]);
    // execFileSync options survive (the timeout bounds the whisper build/model
    // download; the pipes surface its errors).
    assert.deepEqual(resolved.opts.stdio, ["ignore", "pipe", "pipe"]);
    assert.equal(resolved.opts.timeout, 1_800_000);
  }
});

test("without a handed-over CLI: throws the fix instead of running npx", () => {
  for (const platform of ["darwin", "win32"]) {
    assert.throws(
      () => resolveNpxInvocation(WHISPER_ARGV, WHISPER_OPTS, platform, envWithNpxCli, pathExists),
      /HYPERFRAMES_CLI_ENTRY/,
    );
  }
});
