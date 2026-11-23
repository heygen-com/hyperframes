import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { engineBgmLog, projectPath } from "./project-path.mjs";

// A project folder next to a folder outside it, both removed after the test.
function layout(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "mu-project-path-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const dir = join(base, "project");
  const outside = join(base, "outside");
  mkdirSync(dir);
  mkdirSync(outside);
  return { dir, outside };
}

test("a path in the project resolves there, made or not", (t) => {
  const { dir } = layout(t);
  writeFileSync(join(dir, "take.wav"), "take");
  assert.equal(projectPath(dir, "take.wav"), join(dir, "take.wav"));
  assert.equal(projectPath(dir, "sub/../take.wav"), join(dir, "take.wav"));
  assert.equal(projectPath(dir, "assets/voice/new.wav"), join(dir, "assets/voice/new.wav"));
});

test("an absolute path, a climb out, or a link out of the project resolves to nothing", (t) => {
  const { dir, outside } = layout(t);
  writeFileSync(join(outside, "secret.wav"), "secret");
  symlinkSync(outside, join(dir, "linked"));
  symlinkSync(join(outside, "gone.wav"), join(dir, "dangling.wav"));
  for (const rel of [
    join(outside, "secret.wav"),
    "../outside/secret.wav",
    "linked/secret.wav",
    "linked/new.wav",
    "dangling.wav",
  ]) {
    assert.equal(projectPath(dir, rel), null, rel);
  }
});

test("the engine's own BGM log is found by its absolute or project path", (t) => {
  const { dir } = layout(t);
  mkdirSync(join(dir, "assets/bgm"), { recursive: true });
  const log = join(dir, "assets/bgm/bgm-1700000000000.log");
  writeFileSync(log, "rendering");
  assert.equal(engineBgmLog(dir, log), log);
  assert.equal(engineBgmLog(dir, "assets/bgm/bgm-1700000000000.log"), log);
});

test("a BGM log anywhere else, under another name, or behind a link is not read", (t) => {
  const { dir, outside } = layout(t);
  mkdirSync(join(dir, "assets/bgm"), { recursive: true });
  writeFileSync(join(outside, "bgm-1.log"), "secret");
  writeFileSync(join(dir, "assets/bgm/notes.log"), "not a renderer log");
  writeFileSync(join(dir, "bgm-2.log"), "wrong folder");
  symlinkSync(join(outside, "bgm-1.log"), join(dir, "assets/bgm/bgm-3.log"));
  for (const value of [
    join(outside, "bgm-1.log"),
    "../outside/bgm-1.log",
    "assets/bgm/notes.log",
    "bgm-2.log",
    "assets/bgm/bgm-3.log",
    "assets/bgm/bgm-4.log",
    "/proc/self/environ",
    null,
    42,
  ]) {
    assert.equal(engineBgmLog(dir, value), null, String(value));
  }
});

test("a BGM folder that links out of the project holds no engine log", (t) => {
  const { dir, outside } = layout(t);
  writeFileSync(join(outside, "bgm-1.log"), "secret");
  mkdirSync(join(dir, "assets"));
  symlinkSync(outside, join(dir, "assets/bgm"));
  assert.equal(engineBgmLog(dir, "assets/bgm/bgm-1.log"), null);
});
