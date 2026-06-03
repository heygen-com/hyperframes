#!/usr/bin/env tsx

import { execFileSync } from "child_process";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";
import { parseMappedArgument, validateCliDate, type InlineValueOption } from "./cli-options.ts";
import {
  escapeForMdx,
  formatScope,
  parseCommit,
  shouldSkipCommit,
  type ParsedCommit,
  type RawCommit,
} from "./draft-changelog.ts";

const ROOT = join(import.meta.dirname, "..");
const REPO_URL = "https://github.com/heygen-com/hyperframes";
const DOCS_MARKER =
  "{/* New weekly digest entries are prepended by `bun run changelog:weekly --from YYYY-MM-DD --to YYYY-MM-DD --write`. */}";
const WEEKLY_REVIEW_TODO = "<!-- TODO: review and rewrite before publishing. -->";

const CATEGORY_ORDER = [
  "Breaking Changes",
  "Features",
  "Fixes",
  "Performance",
  "Catalog",
  "Docs & Examples",
  "Other Changes",
  "Internal",
];

const HIGHLIGHT_CATEGORIES = new Set([
  "Breaking Changes",
  "Features",
  "Fixes",
  "Performance",
  "Catalog",
]);

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

type WeeklyOptions = {
  from: string;
  to: string;
  write: boolean;
  force: boolean;
};

type MutableWeeklyOptions = Partial<WeeklyOptions>;

type WeeklyCommit = ParsedCommit & {
  date: string;
};

type WeeklyDraft = {
  docsUpdate: string;
  weeklyNotes: string;
  discordDraft: string;
  xDraft: string;
};

type ValueOptionKey = "from" | "to";
type BooleanOptionKey = "write" | "force";

const VALUE_OPTIONS = new Map<string, ValueOptionKey>([
  ["--from", "from"],
  ["--to", "to"],
]);

const BOOLEAN_OPTIONS = new Map<string, BooleanOptionKey>([
  ["--write", "write"],
  ["--force", "force"],
]);

const INLINE_VALUE_OPTIONS = [
  { prefix: "--from=", key: "from" },
  { prefix: "--to=", key: "to" },
] satisfies Array<InlineValueOption<ValueOptionKey>>;

function main() {
  const options = parseWeeklyOptions(process.argv.slice(2));
  const commits = getWeeklyCommits(options);
  const draft = createWeeklyDraft(options, commits);
  outputWeeklyDraft(options, draft);
}

export function parseWeeklyOptions(args: string[]): WeeklyOptions {
  const parsed = createDefaultOptions();

  for (let index = 0; index < args.length; index += 1) {
    index = parseArgument(args, index, parsed);
  }

  return finalizeOptions(parsed);
}

function createDefaultOptions(): MutableWeeklyOptions {
  return {
    write: false,
    force: false,
  };
}

function parseArgument(args: string[], index: number, parsed: MutableWeeklyOptions) {
  const arg = args[index];
  if (arg === "--help" || arg === "-h") {
    printUsage();
    process.exit(0);
  }

  return parseMappedArgument(args, index, parsed, {
    inlineValueOptions: INLINE_VALUE_OPTIONS,
    valueOptions: VALUE_OPTIONS,
    booleanOptions: BOOLEAN_OPTIONS,
    parsePositional: (positional) => fail(`Unexpected positional argument: ${positional}`),
    fail,
  });
}

function finalizeOptions(parsed: MutableWeeklyOptions): WeeklyOptions {
  const { from, to } = requireDateRange(parsed);

  return {
    from,
    to,
    write: parsed.write ?? false,
    force: parsed.force ?? false,
  };
}

function requireDateRange(parsed: MutableWeeklyOptions) {
  if (!parsed.from || !parsed.to) {
    printUsage();
    process.exit(1);
  }

  validateDateRange(parsed.from, parsed.to);
  return {
    from: parsed.from,
    to: parsed.to,
  };
}

function validateDateRange(from: string, to: string) {
  validateCliDate(from, fail);
  validateCliDate(to, fail);
  if (from > to) {
    fail(`Invalid date range: --from ${from} is after --to ${to}.`);
  }
}

function getWeeklyCommits(options: WeeklyOptions): WeeklyCommit[] {
  return getCommits(options.from, options.to)
    .filter((commit) => !shouldSkipCommit(commit))
    .map((commit) => ({
      ...parseCommit(commit),
      date: commit.date,
    }))
    .sort(compareCommitsForDigest);
}

type RawWeeklyCommit = RawCommit & {
  date: string;
};

function getCommits(from: string, to: string): RawWeeklyCommit[] {
  const output = git([
    "log",
    "--format=%H%x09%h%x09%an%x09%cs%x09%s",
    "--no-merges",
    `--since=${from}T00:00:00`,
    `--until=${to}T23:59:59`,
  ]);

  if (!output) {
    return [];
  }

  return output.split("\n").map(parseGitLogLine);
}

function parseGitLogLine(line: string): RawWeeklyCommit {
  const [sha = "", shortSha = "", author = "", date = "", ...subjectParts] = line.split("\t");
  return {
    sha,
    shortSha,
    author,
    date,
    subject: subjectParts.join("\t"),
  };
}

export function createWeeklyDraft(options: WeeklyOptions, commits: WeeklyCommit[]): WeeklyDraft {
  const range = formatDateRange(options.from, options.to);
  const highlights = selectHighlights(commits);

  return {
    docsUpdate: renderDocsUpdate(options, range, commits, highlights),
    weeklyNotes: renderWeeklyNotes(options, range, commits, highlights),
    discordDraft: renderDiscordDraft(range, highlights),
    xDraft: renderXDraft(range, highlights),
  };
}

function outputWeeklyDraft(options: WeeklyOptions, draft: WeeklyDraft) {
  if (!options.write) {
    console.log(draft.weeklyNotes);
    console.log("\n--- Discord draft ---\n");
    console.log(draft.discordDraft);
    console.log("\n--- X draft ---\n");
    console.log(draft.xDraft);
    console.log("\n--- Mintlify update block ---\n");
    console.log(draft.docsUpdate);
    console.log(
      "\nRun with --write to create the weekly digest packet and prepend the docs entry.",
    );
    return;
  }

  writeWeeklyPacket(options, draft);
  prependDocsUpdate(options, draft.docsUpdate);
}

function writeWeeklyPacket(options: WeeklyOptions, draft: WeeklyDraft) {
  const paths = weeklyPacketPaths(options.to);
  mkdirSync(join(ROOT, "updates", "weekly"), { recursive: true });
  mkdirSync(join(ROOT, "updates", "social"), { recursive: true });

  writeFile(paths.weeklyNotes, draft.weeklyNotes, options.force);
  writeFile(paths.discordDraft, draft.discordDraft, options.force);
  writeFile(paths.xDraft, draft.xDraft, options.force);
}

export function weeklyPacketPaths(date: string) {
  return {
    weeklyNotes: join("updates", "weekly", `${date}.md`),
    discordDraft: join("updates", "social", `${date}.discord.md`),
    xDraft: join("updates", "social", `${date}.x.md`),
  };
}

function writeFile(relativePath: string, contents: string, force: boolean) {
  try {
    writeFileSync(join(ROOT, relativePath), `${contents}\n`, { flag: force ? "w" : "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      fail(`${relativePath} already exists. Pass --force to overwrite it before review.`);
    }
    throw error;
  }
  console.log(`Wrote ${relativePath}`);
}

function prependDocsUpdate(options: WeeklyOptions, docsUpdate: string) {
  const weeklyUpdatesPath = join(ROOT, "docs", "weekly-updates.mdx");
  const weeklyUpdates = readFileSync(weeklyUpdatesPath, "utf-8");
  const label = weeklyLabel(options.from);

  if (weeklyUpdates.includes(`label="${label}"`)) {
    console.log(`docs/weekly-updates.mdx already has ${label}; leaving it unchanged.`);
    return;
  }

  if (!weeklyUpdates.includes(DOCS_MARKER)) {
    fail(`Could not find insertion marker in ${weeklyUpdatesPath}`);
  }

  const updated = weeklyUpdates.replace(DOCS_MARKER, `${DOCS_MARKER}\n\n${docsUpdate}`);
  writeFileSync(weeklyUpdatesPath, updated);
  console.log(`Prepended ${label} to ${weeklyUpdatesPath}`);
}

function renderDocsUpdate(
  options: WeeklyOptions,
  range: string,
  commits: WeeklyCommit[],
  highlights: WeeklyCommit[],
) {
  const alsoNotable = selectAlsoNotable(commits, highlights);

  return [
    "<Update",
    `  label="${weeklyLabel(options.from)}"`,
    `  description="Weekly digest - ${range}"`,
    `  tags={["Weekly update", "Highlights"]}`,
    ">",
    WEEKLY_REVIEW_TODO,
    "",
    "A curated summary of the most important HyperFrames changes this week.",
    "",
    renderHighlights(highlights, renderMdxWeeklyBullet),
    "",
    renderAlsoNotable(alsoNotable, renderMdxWeeklyBullet),
    "",
    "For exact versioned release notes, see the [Changelog](/changelog).",
    "</Update>",
  ].join("\n");
}

function renderWeeklyNotes(
  options: WeeklyOptions,
  range: string,
  commits: WeeklyCommit[],
  highlights: WeeklyCommit[],
) {
  return [
    `# HyperFrames weekly digest - ${range}`,
    "",
    WEEKLY_REVIEW_TODO,
    "",
    "This digest is the editable source for the docs weekly update and social drafts.",
    "",
    "## Highlights",
    "",
    renderListOrEmpty(highlights, renderMarkdownWeeklyBullet),
    "",
    "## Full draft",
    "",
    renderGroupedChanges(commits, renderMarkdownWeeklyBullet),
    "",
    "## Publishing checklist",
    "",
    "- Remove the TODO marker after review.",
    "- Run this from an up-to-date `main` branch when drafting the real weekly update.",
    "- Keep the docs entry in `docs/weekly-updates.mdx` aligned with this source file.",
    "- Edit the Discord and X drafts before posting.",
    "- Add screenshots, rendered clips, or catalog links where they make the update clearer.",
    "",
    `Range: ${options.from} through ${options.to}.`,
  ].join("\n");
}

function renderDiscordDraft(range: string, highlights: WeeklyCommit[]) {
  return [
    `# HyperFrames weekly update - ${range}`,
    "",
    WEEKLY_REVIEW_TODO,
    "",
    "This week's highlights:",
    "",
    renderListOrEmpty(highlights, renderPlainWeeklyBullet),
    "",
    "Read the full update: TODO add docs link after publishing.",
  ].join("\n");
}

function renderXDraft(range: string, highlights: WeeklyCommit[]) {
  const threadItems =
    highlights.length > 0
      ? highlights.map((commit, index) => `${index + 1}. ${plainWeeklySummary(commit)}`)
      : ["TODO: add the most important user-facing highlights from this week."];

  return [
    `HyperFrames weekly update - ${range}`,
    "",
    WEEKLY_REVIEW_TODO,
    "",
    ...threadItems,
    "",
    "Full update: TODO add docs link after publishing.",
  ].join("\n");
}

function renderHighlights(
  highlights: WeeklyCommit[],
  renderBullet: (commit: WeeklyCommit) => string,
) {
  return ["## Highlights", "", renderListOrEmpty(highlights, renderBullet)].join("\n");
}

function renderAlsoNotable(
  commits: WeeklyCommit[],
  renderBullet: (commit: WeeklyCommit) => string,
) {
  if (commits.length === 0) {
    return "## Also notable\n\n- TODO: add any supporting changes worth mentioning.";
  }

  return ["## Also notable", "", commits.map(renderBullet).join("\n")].join("\n");
}

function renderGroupedChanges(
  commits: WeeklyCommit[],
  renderBullet: (commit: WeeklyCommit) => string,
) {
  if (commits.length === 0) {
    return "No notable changes were found in the selected date range.";
  }

  return CATEGORY_ORDER.flatMap((category) => {
    const categoryCommits = commits.filter((commit) => commit.category === category);
    if (categoryCommits.length === 0) {
      return [];
    }

    return [`## ${category}`, "", ...categoryCommits.map(renderBullet), ""];
  })
    .join("\n")
    .trim();
}

function renderListOrEmpty(
  commits: WeeklyCommit[],
  renderBullet: (commit: WeeklyCommit) => string,
) {
  if (commits.length === 0) {
    return "- TODO: add the most important user-facing highlights from this week.";
  }

  return commits.map(renderBullet).join("\n");
}

function renderMarkdownWeeklyBullet(commit: WeeklyCommit) {
  const scope = commit.scope ? `**${formatScope(commit.scope)}:** ` : "";
  return `- ${scope}${capitalize(commit.summary)} (${commitLinks(commit).join(", ")})`;
}

function renderMdxWeeklyBullet(commit: WeeklyCommit) {
  const scope = commit.scope ? `**${escapeForMdx(formatScope(commit.scope))}:** ` : "";
  return `- ${scope}${escapeForMdx(capitalize(commit.summary))} (${commitLinks(commit).join(", ")})`;
}

function renderPlainWeeklyBullet(commit: WeeklyCommit) {
  return `- ${plainWeeklySummary(commit)}`;
}

function plainWeeklySummary(commit: WeeklyCommit) {
  const scope = commit.scope ? `${formatScope(commit.scope)}: ` : "";
  return `${scope}${capitalize(commit.summary)}`;
}

function commitLinks(commit: WeeklyCommit) {
  const links = [`[${commit.shortSha}](${REPO_URL}/commit/${commit.sha})`];
  if (commit.prNumber) {
    links.push(`[#${commit.prNumber}](${REPO_URL}/pull/${commit.prNumber})`);
  }
  return links;
}

function selectHighlights(commits: WeeklyCommit[]) {
  const highlighted = commits.filter(isHighImpactCandidate);
  const fallback = commits.filter((commit) => commit.category !== "Internal");
  return (highlighted.length > 0 ? highlighted : fallback).slice(0, 5);
}

function selectAlsoNotable(commits: WeeklyCommit[], highlights: WeeklyCommit[]) {
  const highlightedShas = new Set(highlights.map((commit) => commit.sha));
  return commits
    .filter((commit) => commit.category !== "Internal")
    .filter((commit) => !highlightedShas.has(commit.sha))
    .slice(0, 5);
}

function isHighImpactCandidate(commit: WeeklyCommit) {
  return HIGHLIGHT_CATEGORIES.has(commit.category) && !isEditorialOnlyScope(commit.scope);
}

function isEditorialOnlyScope(scope: string | undefined) {
  if (!scope) {
    return false;
  }

  return ["docs", "readme", "skills"].includes(scope.toLowerCase());
}

function compareCommitsForDigest(a: WeeklyCommit, b: WeeklyCommit) {
  const categoryDelta = categoryRank(a.category) - categoryRank(b.category);
  if (categoryDelta !== 0) {
    return categoryDelta;
  }

  return b.date.localeCompare(a.date);
}

function categoryRank(category: string) {
  const index = CATEGORY_ORDER.indexOf(category);
  return index === -1 ? CATEGORY_ORDER.length : index;
}

function weeklyLabel(from: string) {
  return `Week of ${formatDate(from)}`;
}

function formatDateRange(from: string, to: string) {
  return `${formatDate(from)} - ${formatDate(to)}`;
}

function formatDate(date: string) {
  const { year, month, day } = dateParts(date);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

function dateParts(date: string) {
  const [year = "0", month = "0", day = "0"] = date.split("-");
  return {
    year,
    month: Number(month),
    day: Number(day),
  };
}

function capitalize(value: string) {
  if (!value) {
    return value;
  }
  return value[0].toUpperCase() + value.slice(1);
}

function git(args: string[]) {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf-8",
  }).trim();
}

function printUsage() {
  console.log(`changelog:weekly drafts an editable weekly digest packet.

Usage:
  bun run changelog:weekly --from YYYY-MM-DD --to YYYY-MM-DD [--write] [--force]

Examples:
  bun run changelog:weekly --from 2026-06-01 --to 2026-06-07
  bun run changelog:weekly --from 2026-06-01 --to 2026-06-07 --write
  bun run changelog:weekly --from 2026-06-01 --to 2026-06-07 --write --force
`);
}

function fail(message: string): never {
  console.error(`changelog:weekly: ${message}`);
  process.exit(1);
}

function isDirectRun(scriptPath: string | undefined) {
  return scriptPath ? import.meta.url === pathToFileURL(scriptPath).href : false;
}

if (isDirectRun(process.argv[1])) {
  main();
}
