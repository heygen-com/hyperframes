import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withFileLock } from "./config-lock.mjs";

function lockIn() {
  const dir = fs.mkdtempSync(join(tmpdir(), "hf-config-lock-"));
  return {
    lock: join(dir, "config.json.lock"),
    cleanup: () => fs.rmSync(dir, { recursive: true }),
  };
}

test("releasing leaves a lock another process took meanwhile", () => {
  const { lock, cleanup } = lockIn();
  try {
    withFileLock(lock, fs, () => fs.writeFileSync(lock, "other"));
    assert.equal(fs.readFileSync(lock, "utf8"), "other");
  } finally {
    cleanup();
  }
});

test("takes over a lock left behind by a process that died holding it", () => {
  const { lock, cleanup } = lockIn();
  try {
    fs.writeFileSync(lock, "dead");
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(lock, past, past);
    assert.equal(
      withFileLock(lock, fs, () => "ran"),
      "ran",
    );
    assert.equal(fs.existsSync(lock), false);
  } finally {
    cleanup();
  }
});

test("puts back a live lock that replaced the stale one just before the takeover", () => {
  const { lock, cleanup } = lockIn();
  try {
    fs.writeFileSync(lock, "dead");
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(lock, past, past);
    let restored;
    const racing = {
      ...fs,
      renameSync(from, to) {
        if (from === lock && !restored) {
          fs.rmSync(lock);
          fs.writeFileSync(lock, "live");
        }
        fs.renameSync(from, to);
      },
      linkSync(from, to) {
        fs.linkSync(from, to);
        restored = fs.readFileSync(lock, "utf8");
        fs.rmSync(lock);
      },
    };
    withFileLock(lock, racing, () => {});
    assert.equal(restored, "live");
  } finally {
    cleanup();
  }
});
