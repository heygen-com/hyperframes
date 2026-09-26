import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
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

test("waits for another process's takeover of a stale lock instead of racing it", async () => {
  const { lock, cleanup } = lockIn();
  try {
    fs.writeFileSync(lock, "dead");
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(lock, past, past);
    // Another process holds the reaper, replaces the stale lock with its own, then releases after a pause.
    const script = `
      const fs = require("fs");
      const lock = process.argv[1];
      fs.writeFileSync(lock + ".reap", "other", { flag: "wx" });
      process.stdout.write("reaping\\n");
      setTimeout(() => {
        fs.rmSync(lock);
        fs.writeFileSync(lock, "other", { flag: "wx" });
        fs.rmSync(lock + ".reap");
        setTimeout(() => {
          fs.writeFileSync(lock + ".released", String(Date.now()));
          fs.rmSync(lock);
        }, 300);
      }, 300);`;
    const other = spawn(process.execPath, ["-e", script, lock]);
    await new Promise((ready) => other.stdout.once("data", ready));

    const ranAt = withFileLock(lock, fs, () => Date.now());

    assert.ok(ranAt >= Number(fs.readFileSync(`${lock}.released`, "utf8")));
    await new Promise((exited) => other.once("exit", exited));
  } finally {
    cleanup();
  }
});
