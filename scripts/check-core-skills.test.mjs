import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkCoreSkills,
  descriptionOf,
  missingPaths,
  registeredCommands,
  unknownCommands,
} from "./check-core-skills.mjs";

test("the repo's core skills pass", () => {
  assert.deepEqual(checkCoreSkills(), []);
});

test("the skills teach the direct sign-in, not the old key and executable rules", () => {
  const read = (path) => readFileSync(new URL(`../skills/${path}`, import.meta.url), "utf8");
  assert.doesNotMatch(read("reverse-any-video/references/people.md"), /Without a HeyGen key/);
  assert.doesNotMatch(read("media-use/SKILL.md"), /HeyGen calls also need/);
  const heygen = read("media-use/references/heygen.md");
  assert.match(heygen, /~\/\.hyperframes\/credentials/);
  assert.doesNotMatch(heygen, /~\/\.heygen\/credentials/);
});

test("reads the registered commands, quoted or not", () => {
  const source = `const commandLoaders = {\n  init: () => x,\n  "catch-up": () => y,\n};`;
  assert.deepEqual([...registeredCommands(source)], ["init", "catch-up"]);
});

test("flags a command the CLI does not register", () => {
  const content = "Run `npx hyperframes check --json`, then `npx hyperframes frame 3`.";
  assert.deepEqual(unknownCommands(content, new Set(["check"])), ["frame"]);
});

test("reads a one-line description", () => {
  assert.equal(
    descriptionOf("---\nname: x\ndescription: Does a thing.\n---\n# x"),
    "Does a thing.",
  );
});

test("flags a path the skill does not ship, and skips placeholders", () => {
  const dir = mkdtempSync(join(tmpdir(), "core-skills-"));
  mkdirSync(join(dir, "references"));
  writeFileSync(join(dir, "references", "a.md"), "# a");
  const content = "`references/a.md`, `references/b.md`, `references/routes/<workflow>.md`";
  assert.deepEqual(missingPaths(content, dir), ["references/b.md"]);
});
