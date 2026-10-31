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
export const CORE_SKILLS = {
  hyperframes: 7168,
  "hyperframes-cli": 7168,
  "hyperframes-registry": 5120,
  "media-use": 5120,
  figma: 7168,
  slideshow: 5120,
  "remotion-to-hyperframes": 5120,
  "reverse-any-video": 5120,
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

/** @param {string} root */
export function checkCoreSkills(root = REPO_ROOT) {
  const commands = registeredCommands(readFileSync(join(root, "packages/cli/src/cli.ts"), "utf8"));
  return Object.entries(CORE_SKILLS).flatMap(([skill, maxBytes]) => {
    const file = skillFile(skill, root);
    const content = readFileSync(file, "utf8");
    const names = maxBytes === null ? [] : nameProblems(skill, content, dirname(file), commands);
    return [...sizeProblems(skill, content, maxBytes), ...names];
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = checkCoreSkills();
  for (const problem of problems) console.error(`✗ ${problem}`);
  if (problems.length > 0) process.exit(1);
  console.log(`✓ core skills within budget; commands and paths resolve`);
}
