import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const config = parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "lefthook.yml"), "utf8"),
);
const jobs = config["pre-commit"].jobs ?? [];

test("the skills manifest is hashed after the formatter has rewritten the skills", () => {
  const group = jobs.find((job) => job.group?.jobs?.some((j) => j.name === "skills-manifest"));
  assert.ok(group, "skills-manifest must sit in a group, not run beside the formatter");
  assert.equal(group.group.piped, true, "the group must run its jobs in order");
  const names = group.group.jobs.map((j) => j.name);
  assert.ok(names.includes("format"), "the group must hold the formatter");
  assert.ok(names.indexOf("format") < names.indexOf("skills-manifest"));
});
