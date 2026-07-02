import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawnP } from "./tts.mjs";

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

test("spawnP enables shell for npx on win32", async () => {
  const captured = [];
  await spawnP("npx", ["hyperframes", "tts"], {}, "win32", fakeSpawn(captured));
  assert.equal(captured.length, 1);
  assert.equal(captured[0].opts.shell, true);
});

test("spawnP does not enable shell for npx on darwin/linux", async () => {
  const captured = [];
  await spawnP("npx", ["hyperframes", "tts"], {}, "darwin", fakeSpawn(captured));
  assert.equal(captured[0].opts.shell, false);
});

test("spawnP does not enable shell for non-npx commands even on win32", async () => {
  const captured = [];
  await spawnP("python3", ["-c", "pass"], {}, "win32", fakeSpawn(captured));
  assert.equal(captured[0].opts.shell, false);
});
