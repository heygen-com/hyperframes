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

test("returns the task's result even when the lock cannot be released", () => {
  const { lock, cleanup } = lockIn();
  try {
    const refusing = {
      ...fs,
      rmSync(path, options) {
        if (path === lock) throw Object.assign(new Error("EPERM"), { code: "EPERM" });
        return fs.rmSync(path, options);
      },
    };
    assert.equal(
      withFileLock(lock, refusing, () => "saved"),
      "saved",
    );
  } finally {
    cleanup();
  }
});

test("refuses a lock left by a process that stopped, names it, and never removes it", () => {
  const { lock, cleanup } = lockIn();
  try {
    fs.writeFileSync(lock, "dead");
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(lock, past, past);
    const started = Date.now();
    let ran = false;

    assert.throws(
      () => withFileLock(lock, fs, () => (ran = true)),
      (error) => error.code === "HF_SETTINGS_LOCKED" && error.message.includes(lock),
    );
    assert.ok(Date.now() - started < 1000);
    assert.equal(ran, false);
    assert.equal(fs.readFileSync(lock, "utf8"), "dead");
  } finally {
    cleanup();
  }
});

test("waits for a process that holds the lock, then takes it", async () => {
  const { lock, cleanup } = lockIn();
  try {
    const script = `
      const fs = require("fs");
      const lock = process.argv[1];
      fs.writeFileSync(lock, "other", { flag: "wx" });
      process.stdout.write("locked\\n");
      setTimeout(() => {
        fs.writeFileSync(lock + ".released", String(Date.now()));
        fs.rmSync(lock);
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
