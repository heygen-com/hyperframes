#!/usr/bin/env node
// Holds the core skills to their size budgets and checks what their entry files name: every
// `npx hyperframes <command>` against the commands packages/cli/src/cli.ts registers, and every
// path in backticks against the skill folder it is relative to.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Every installed skill's description is listed on every turn; an entry is read in full when it opens.
export const DESCRIPTION_MAX = 320;
// Each budget carries +192 B for the usage beacon line (`beaconProblems`).
export const CORE_SKILLS = {
  // +128 B for the routing rows to the video rebuilds and to a reference's style, which only trigger when the entry hands them on.
  hyperframes: 7488,
  // +256 B for the `_meta.updateNotice` line: the agent relays it, the person updates.
  "hyperframes-cli": 7616,
  "hyperframes-registry": 5312,
  "media-use": 5312,
  figma: 7360,
  slideshow: 5312,
  "remotion-to-hyperframes": 5312,
  "reverse-any-video": 5312,
  "style-sampling": 5312,
};

/** @param {string} skill */
const skillFile = (skill, root = REPO_ROOT) => join(root, "skills", skill, "SKILL.md");

/** @param {string} content */
export function descriptionOf(content) {
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(content)?.[1] ?? "";
  return /^description:[ \t]*(.*)$/m.exec(frontmatter)?.[1].trim() ?? "";
}

/** The top-level command names the CLI registers. @param {string} cliSource */
export function registeredCommands(cliSource) {
  const block = /const commandLoaders = \{([\s\S]*?)\n\};/.exec(cliSource)?.[1] ?? "";
  return new Set([...block.matchAll(/^\s+"?([a-z][a-z-]*)"?:/gm)].map((m) => m[1]));
}

/** @param {string} content @param {Set<string>} commands */
export function unknownCommands(content, commands) {
  const named = [...content.matchAll(/npx hyperframes(?:@[\w.]+)? ([a-z][a-z-]*)/g)].map(
    (m) => m[1],
  );
  return [...new Set(named)].filter((name) => !commands.has(name));
}

// A backtick span that is a relative path to a file this skill ships, such as one under references/.
const PATH_SPAN = /`((?:\.\.\/)*[a-z0-9][\w.-]*(?:\/[\w.-]+)+\.(?:md|html|json))(?:#[^`]*)?`/g;

/** @param {string} content @param {string} skillDir */
export function missingPaths(content, skillDir) {
  const paths = [...content.matchAll(PATH_SPAN)].map((m) => m[1]);
  return [...new Set(paths)].filter((p) => !p.includes("<") && !existsSync(join(skillDir, p)));
}

/** Size problems: the entry over its budget, the description over the per-skill cap. */
function sizeProblems(skill, content, maxBytes) {
  const bytes = Buffer.byteLength(content);
  const description = Buffer.byteLength(descriptionOf(content));
  return [
    ...(maxBytes !== null && bytes > maxBytes
      ? [`${skill}/SKILL.md is ${bytes} B, over its ${maxBytes} B budget`]
      : []),
    ...(description > DESCRIPTION_MAX
      ? [`${skill} description is ${description} B, over ${DESCRIPTION_MAX} B`]
      : []),
  ];
}

/** Names the entry teaches that do not exist: CLI commands and shipped paths. */
function nameProblems(skill, content, skillDir, commands) {
  return [
    ...unknownCommands(content, commands).map(
      (name) =>
        `${skill}/SKILL.md names \`npx hyperframes ${name}\`, which the CLI does not register`,
    ),
    ...missingPaths(content, skillDir).map(
      (path) => `${skill}/SKILL.md points at \`${path}\`, which does not exist`,
    ),
  ];
}

/** The skill's own `skill_invoked` beacon, so every run of it is counted by name. */
export const beaconCommand = (skill) => `npx hyperframes events --skill=${skill}\``;

/** @param {string} skill @param {string} content */
export function beaconProblems(skill, content) {
  return content.includes(beaconCommand(skill))
    ? []
    : [`${skill}/SKILL.md does not run \`npx hyperframes events --skill=${skill}\` as it starts`];
}

/** @param {string} root */
export function checkCoreSkills(root = REPO_ROOT) {
  const commands = registeredCommands(readFileSync(join(root, "packages/cli/src/cli.ts"), "utf8"));
  return Object.entries(CORE_SKILLS).flatMap(([skill, maxBytes]) => {
    const file = skillFile(skill, root);
    const content = readFileSync(file, "utf8");
    const names = maxBytes === null ? [] : nameProblems(skill, content, dirname(file), commands);
    return [...sizeProblems(skill, content, maxBytes), ...names, ...beaconProblems(skill, content)];
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = checkCoreSkills();
  for (const problem of problems) console.error(`✗ ${problem}`);
  if (problems.length > 0) process.exit(1);
  console.log(`✓ core skills within budget; commands and paths resolve`);
}
