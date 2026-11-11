import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  beaconProblems,
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

test("the paid-plan cloud final keeps the composition fps and high quality", () => {
  for (const path of ["hyperframes-cli/SKILL.md", "hyperframes-cli/references/cloud.md"]) {
    const text = readFileSync(new URL(`../skills/${path}`, import.meta.url), "utf8");
    assert.match(text, /`cloud render --fps <data-fps> --quality high -o [^`]+`/, path);
  }
});

test("media-use lists Voice Turbo as free only on the Free plan, not for every sign-in", () => {
  const text = readFileSync(new URL("../skills/media-use/SKILL.md", import.meta.url), "utf8");
  assert.match(text, /\| Voice Turbo, Free plan: 3 min a month \| Voice Turbo on a paid plan/);
  assert.doesNotMatch(text, /Voice Turbo \(signed in\)/);
});

test("reverse builds the project with init --video and asks for the run's total once", () => {
  const read = (path) =>
    readFileSync(new URL(`../skills/reverse-any-video/${path}`, import.meta.url), "utf8");
  const start = read("references/start.md");
  assert.match(
    start,
    /`npx hyperframes init <project> --video <video> --keep-original --skip-transcribe --skip-skills`/,
  );
  assert.match(
    start,
    /add up what each refused step\s+needs, and give them `npx hyperframes billing (?:top-up|add-credits) --needed <total>(?: --skill reverse-any-video)?` to run once for that total/,
  );
  assert.doesNotMatch(read("SKILL.md"), /copy the video into the project/);
  assert.match(read("SKILL.md"), /`init --video` put the video in/);
});

test("reverse hands every purchase to the person instead of running billing itself", () => {
  const read = (path) =>
    readFileSync(new URL(`../skills/reverse-any-video/${path}`, import.meta.url), "utf8");
  const start = read("references/start.md");
  const section = (heading) => start.split(`## ${heading}`)[1].split("\n## ")[0];
  assert.match(
    read("SKILL.md"),
    /give the person its upgrade link and `fix` to run themselves \(you never run `billing`\)/,
  );
  assert.match(start, /You run every command except `billing`, which\s+is theirs/);
  assert.doesNotMatch(start, /you run every command,/);
  const outOfCredits = section("Out of credits mid-run");
  assert.match(
    outOfCredits,
    /If any refusal prints no amount, the total is unknown:\s+give plain `billing add-credits` once instead, for the whole run/,
  );
  assert.doesNotMatch(
    outOfCredits,
    /for that one|for each (?:refused )?step|one per (?:refused )?step(?!\.)/,
  );
  for (const heading of ["Signed in on Free", "Out of credits mid-run"]) {
    const text = section(heading);
    assert.match(text, /never run a `billing` command yourself/, heading);
    assert.match(text, /for them to run|to run once for that total/, heading);
    const rest = text.replace("never run a `billing` command yourself", "");
    assert.doesNotMatch(
      rest,
      /\b(?:run|execute|launch)\b[^.\n]{0,60}(?:`(?:npx hyperframes )?billing|`reverse\.subscribe_command`)/i,
      heading,
    );
  }
});

test("flags a skill that never reports its own run", () => {
  assert.deepEqual(
    beaconProblems("slideshow", "Run `npx hyperframes events --skill=slideshow` first."),
    [],
  );
  assert.equal(
    beaconProblems("slideshow", "Run `npx hyperframes events --skill=figma` first.").length,
    1,
  );
  assert.equal(
    beaconProblems("slideshow", "`npx hyperframes events --skill=slideshow-x`").length,
    1,
  );
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

test("style-sampling picks a voice from the HyperFrames account, never the separate heygen sign-in", () => {
  const remix = readFileSync(
    new URL("../skills/style-sampling/references/remix.md", import.meta.url),
    "utf8",
  );
  assert.match(remix, /`npx hyperframes media-use voices`/);
  assert.doesNotMatch(remix.replace(/never `heygen voice list`/, ""), /heygen voice list/);
});
