// node --test scripts/test-clock-ahead.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const preload = fileURLToPath(new URL("./test-clock-ahead.mjs", import.meta.url));
const AHEAD_MS = 3653 * 86_400_000;
const dir = mkdtempSync(join(tmpdir(), "clock-ahead-"));
const file = (name, text) => {
  writeFileSync(join(dir, name), text);
  return join(dir, name);
};
/** What a script prints when it runs with the preload and no NODE_OPTIONS of its own. */
const run = (script) =>
  JSON.parse(
    execFileSync(process.execPath, ["--import", preload, script], {
      encoding: "utf8",
      env: { ...process.env, NODE_OPTIONS: "" },
    }),
  );
const near = (actual, expected) => Math.abs(actual - expected) < 5_000;

test("Date reads ten years ahead of the real clock, and a date a test names stays where it was put", () => {
  const out = run(
    file(
      "main.mjs",
      `import { performance } from "node:perf_hooks";
const real = performance.timeOrigin + performance.now();
class Stamp extends Date {}
console.log(JSON.stringify({
  ahead: Date.now() - real, constructed: new Date().getTime() - real, called: Date.parse(Date()) - real,
  named: new Date("2026-11-07T00:00:00Z").toISOString(), epoch: new Date(0).getTime(), parts: new Date(2026, 0, 2).getDate(),
  isDate: new Date() instanceof Date, subclass: new Stamp() instanceof Stamp && new Stamp().getTime() - real, name: Date.name,
}));`,
    ),
  );
  for (const key of ["ahead", "constructed", "subclass"])
    assert.ok(near(out[key], AHEAD_MS), `${key}: ${out[key]}`);
  assert.ok(Math.abs(out.called - AHEAD_MS) < 6_000, `Date(): ${out.called}`);
  assert.deepEqual(
    [out.named, out.epoch, out.parts, out.isDate, out.name],
    ["2026-11-07T00:00:00.000Z", 0, 2, true, "Date"],
  );
});

test("a test that would only expire on a later day is already expired", () => {
  const out = run(
    file(
      "bomb.mjs",
      `import { performance } from "node:perf_hooks";
const offeredToday = performance.timeOrigin + performance.now();
const expiresAt = offeredToday + 14 * 86_400_000;
console.log(JSON.stringify({ expired: Date.now() >= expiresAt }));`,
    ),
  );
  assert.equal(out.expired, true);
});

test("a worker thread and a child process read the same clock as the process that started them", () => {
  file(
    "worker.mjs",
    `import { parentPort } from "node:worker_threads";\nparentPort.postMessage(Date.now());`,
  );
  const out = run(
    file(
      "family.mjs",
      `import { execFileSync } from "node:child_process";
import { Worker } from "node:worker_threads";
const worker = await new Promise((done) => new Worker(new URL("./worker.mjs", import.meta.url)).on("message", done));
const child = Number(execFileSync(process.execPath, ["-e", "console.log(Date.now())"], { encoding: "utf8" }));
console.log(JSON.stringify({ worker: worker - Date.now(), child: child - Date.now() }));`,
    ),
  );
  assert.ok(near(out.worker, 0), `worker: ${out.worker}`);
  assert.ok(near(out.child, 0), `child: ${out.child}`);
});
