import { test } from "node:test";
import assert from "node:assert/strict";
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
    assert.deepEqual(captured[0].args.slice(0, 3), [entry, "tts", "hello & there"]);
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
