import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { resolveNpxCliFromNpmExecPath, resolveSpawnCommand, spawnP } from "./tts.mjs";

// Regression: on Windows, npx resolves to npx.cmd, which spawn() cannot exec
// without shell:true — it fails ENOENT, silently swallowed as ok:false by the
// caller. spawnP takes injectable platform/spawnFn params so this doesn't
// need to touch the real process.platform or mock node:child_process (whose
// ESM exports are non-configurable).
function fakeSpawn(captured) {
  return (cmd, args, opts) => {
    captured.push({ cmd, args, opts });
    const p = new EventEmitter();
    setImmediate(() => p.emit("exit", 0));
    return p;
  };
}

const envWithNpxCli = {
  npm_execpath: "/opt/node/lib/node_modules/npm/bin/npm-cli.js",
  npm_node_execpath: "/opt/node/bin/node",
};
const npxCliPath = "/opt/node/lib/node_modules/npm/bin/npx-cli.js";
const pathExists = (path) => path === npxCliPath;

test("resolveNpxCliFromNpmExecPath finds npx-cli next to npm-cli", () => {
  assert.equal(resolveNpxCliFromNpmExecPath(envWithNpxCli.npm_execpath, pathExists), npxCliPath);
});

test("resolveSpawnCommand routes npx through node+npx-cli on win32 without shell:true", () => {
  const resolved = resolveSpawnCommand(
    "npx",
    ["hyperframes", "tts", "C:\\Users\\Test User\\line.txt", "--voice", "am_michael"],
    {},
    "win32",
    envWithNpxCli,
    pathExists,
  );
  assert.ok(resolved);
  assert.equal(resolved.cmd, envWithNpxCli.npm_node_execpath);
  assert.deepEqual(resolved.args, [
    npxCliPath,
    "hyperframes",
    "tts",
    "C:\\Users\\Test User\\line.txt",
    "--voice",
    "am_michael",
  ]);
  assert.equal(resolved.opts.shell, undefined);
});

test("resolveSpawnCommand preserves Windows npx shell metacharacters as argv data", () => {
  const resolved = resolveSpawnCommand(
    "npx",
    ["hyperframes", "tts", "hello & calc"],
    {},
    "win32",
    envWithNpxCli,
    pathExists,
  );
  assert.ok(resolved);
  assert.deepEqual(resolved.args, [npxCliPath, "hyperframes", "tts", "hello & calc"]);
});

test("spawnP uses the resolved node+npx-cli command for npx on win32", async () => {
  const captured = [];
  await spawnP(
    "npx",
    ["hyperframes", "tts"],
    {},
    "win32",
    fakeSpawn(captured),
    envWithNpxCli,
    pathExists,
  );
  assert.equal(captured.length, 1);
  assert.equal(captured[0].cmd, envWithNpxCli.npm_node_execpath);
  assert.deepEqual(captured[0].args, [npxCliPath, "hyperframes", "tts"]);
  assert.equal(captured[0].opts.shell, undefined);
});

test("spawnP does not enable shell for npx on darwin/linux", async () => {
  const captured = [];
  await spawnP("npx", ["hyperframes", "tts"], {}, "darwin", fakeSpawn(captured));
  assert.equal(captured[0].cmd, "npx");
  assert.deepEqual(captured[0].args, ["hyperframes", "tts"]);
  assert.equal(captured[0].opts.shell, undefined);
});

test("spawnP does not enable shell for non-npx commands even on win32", async () => {
  const captured = [];
  await spawnP("python3", ["-c", "pass"], {}, "win32", fakeSpawn(captured));
  assert.equal(captured[0].cmd, "python3");
  assert.deepEqual(captured[0].args, ["-c", "pass"]);
  assert.equal(captured[0].opts.shell, undefined);
});
