import { test } from "node:test";
import assert from "node:assert/strict";
import { localTtsGenerate } from "./tts-local-provider.mjs";

// Regression: on Windows, a bare "npx" is npx.cmd, which execFileSync cannot
// exec — the Kokoro delegation failed with `spawnSync npx ENOENT` instead of
// synthesizing (or cleanly falling through to the next provider). The spawn
// must route through node + npx-cli.js on win32, same as the audio engine's
// TTS spawns (see ../../audio/scripts/lib/tts.spawn.test.mjs).

const envWithNpxCli = {
  npm_execpath: "C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js",
  npm_node_execpath: "C:/Program Files/nodejs/node.exe",
};
const npxCliPath = "C:/Program Files/nodejs/node_modules/npm/bin/npx-cli.js";
const pathExists = (path) => path === npxCliPath;

test("win32: routes the hyperframes tts call through node + npx-cli, never bare npx", async () => {
  const captured = [];
  const fakeExec = (cmd, args, opts) => {
    captured.push({ cmd, args, opts });
    // Synthesize nothing — the provider then returns null via the
    // missing-output check, which is fine: we only assert the spawn shape.
  };

  await localTtsGenerate(
    "hello there",
    { voice: "am_michael" },
    "win32",
    fakeExec,
    envWithNpxCli,
    pathExists,
  );

  assert.equal(captured.length, 1);
  assert.equal(captured[0].cmd, envWithNpxCli.npm_node_execpath);
  assert.equal(captured[0].args[0], npxCliPath);
  assert.deepEqual(captured[0].args.slice(1, 4), ["hyperframes", "tts", "hello there"]);
  assert.ok(captured[0].args.includes("--voice"));
  // execFileSync options survive the rerouting (pipes are what let the caller
  // read the "kokoro-onnx not installed" hint back out).
  assert.deepEqual(captured[0].opts.stdio, ["ignore", "pipe", "pipe"]);
});

test("win32 without a resolvable npx-cli: falls through to the next provider (null), no spawn", async () => {
  const captured = [];
  const fakeExec = (...call) => captured.push(call);

  const result = await localTtsGenerate(
    "hello",
    {},
    "win32",
    fakeExec,
    {}, // no npm_execpath, and pathExists finds nothing
    () => false,
  );

  assert.equal(result, null);
  assert.equal(captured.length, 0);
});

test("non-win32: spawns plain npx unchanged", async () => {
  const captured = [];
  const fakeExec = (cmd, args) => captured.push({ cmd, args });

  await localTtsGenerate("hola", { lang: "es" }, "darwin", fakeExec, {}, () => false);

  assert.equal(captured.length, 1);
  assert.equal(captured[0].cmd, "npx");
  assert.deepEqual(captured[0].args.slice(0, 3), ["hyperframes", "tts", "hola"]);
  assert.ok(captured[0].args.includes("--lang"));
});
