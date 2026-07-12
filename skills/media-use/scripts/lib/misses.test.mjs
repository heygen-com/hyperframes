import { strict as assert } from "node:assert";
import { test } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMisses, recordMiss } from "./misses.mjs";

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "mu-misses-"));
  const home = join(root, "home");
  mkdirSync(home, { recursive: true });
  process.env.HOME = home;
  return { root, home };
}

function restoreEnv(saved) {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
}

test("recordMiss appends a well-formed local miss", () => {
  const savedEnv = { ...process.env };
  const { root, home } = sandbox();
  try {
    recordMiss({ type: "bgm", intent: "moody synth pulse", provider_override: true });
    const misses = readMisses();
    assert.equal(misses.length, 1);
    assert.equal(misses[0].type, "bgm");
    assert.equal(misses[0].intent, "moody synth pulse");
    assert.equal(misses[0].provider_override, true);
    assert.equal(misses[0].local_only, false);
    assert.ok(!Number.isNaN(Date.parse(misses[0].ts)));

    const raw = readFileSync(join(home, ".media/misses.jsonl"), "utf8");
    assert.match(raw, /moody synth pulse/);
  } finally {
    restoreEnv(savedEnv);
    rmSync(root, { recursive: true, force: true });
  }
});

test("recordMiss swallows filesystem failures", () => {
  const savedEnv = { ...process.env };
  const { root, home } = sandbox();
  try {
    writeFileSync(join(home, ".media"), "not a directory");
    assert.doesNotThrow(() =>
      recordMiss({ type: "image", intent: "unwritable", local_only: true }),
    );
    assert.equal(existsSync(join(home, ".media/misses.jsonl")), false);
  } finally {
    restoreEnv(savedEnv);
    rmSync(root, { recursive: true, force: true });
  }
});

test("readMisses skips corrupt lines", () => {
  const savedEnv = { ...process.env };
  const { root, home } = sandbox();
  try {
    mkdirSync(join(home, ".media"), { recursive: true });
    writeFileSync(
      join(home, ".media/misses.jsonl"),
      [
        JSON.stringify({ ts: "2026-07-09T00:00:00.000Z", type: "bgm", intent: "one" }),
        "{not json",
        JSON.stringify({ ts: "2026-07-09T00:00:01.000Z", type: "sfx", intent: "two" }),
      ].join("\n"),
    );
    assert.deepEqual(
      readMisses().map((miss) => miss.intent),
      ["one", "two"],
    );
  } finally {
    restoreEnv(savedEnv);
    rmSync(root, { recursive: true, force: true });
  }
});
