import { test } from "node:test";
import assert from "node:assert/strict";
import { countSyncCalls, gained } from "./check-studio-server-sync-fs.mjs";

test("counts synchronous fs calls a file makes, not the ones a comment names", () => {
  const source = [
    "const stat = existsSync(file) ? statSync(file) : null;",
    "// readFileSync(file) would hold the event loop",
    "const text = await readFile(file);",
    "const names = readdirSync (dir);",
    "const real = realpathSync.native(dir);",
    "readSync(fd, buffer); writeSync(fd, buffer); fstatSync(fd);",
  ].join("\n");
  assert.equal(countSyncCalls(source), 7);
});

test("a file may lose synchronous fs calls, never gain one, and a new file starts at none", () => {
  const baseline = { "routes/preview.ts": 4 };
  assert.deepEqual(gained({ "routes/preview.ts": 3 }, baseline), []);
  assert.deepEqual(gained({ "routes/preview.ts": 5, "routes/new.ts": 1 }, baseline), [
    "routes/preview.ts: 5 synchronous fs calls, 4 allowed",
    "routes/new.ts: 1 synchronous fs calls, 0 allowed",
  ]);
});
