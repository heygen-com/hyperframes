import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { heygenTtsGenerate } from "./voice-provider.mjs";
import { creditLimit, creditsSpent } from "./credit-limit.mjs";

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), "hf-limit-"));
  mkdirSync(join(dir, ".hyperframes"));
  for (const [name, text] of Object.entries(files))
    writeFileSync(join(dir, ".hyperframes", name), text);
  return dir;
}

test("no limit file means no limit; a malformed one is an error, not no limit", () => {
  assert.equal(creditLimit(project({})), undefined);
  assert.equal(creditLimit(project({ "credit-limit.json": '{"credits": 500}' })), 500);
  assert.throws(() => creditLimit(project({ "credit-limit.json": '{"credits": "lots"}' })));
});

test("spent is the last credits each job key logged", () => {
  const rows = [
    { key: "a", credits: 50 },
    { key: "a", credits: 0 },
    { key: "b", credits: 30 },
    { key: "b", status: "completed" },
  ];
  const dir = project({ "heygen-jobs.jsonl": rows.map((r) => JSON.stringify(r)).join("\n") });
  const spent = creditsSpent(dir);
  assert.equal(spent.total, 30);
  assert.deepEqual([...spent.keys], ["b"]);
});

test("resolve's HeyGen voice is refused under a limit before the heygen CLI runs", async () => {
  const dir = project({ "credit-limit.json": '{"credits": 10}' });
  await assert.rejects(heygenTtsGenerate("hello", { projectDir: dir }), /credit limit of 10/);
});
