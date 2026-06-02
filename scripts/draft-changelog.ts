#!/usr/bin/env tsx

import { execFileSync } from "child_process";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";
import {
  CLI_SEMVER_PATTERN,
  parseVersionOptionArgument,
  validateCliDate,
  validateCliVersion,
  type InlineValueOption,
} from "./cli-options.ts";

const ROOT = join(import.meta.dirname, "..");
const REPO_URL = "https://github.com/heygen-com/hyperframes";
const DOCS_MARKER =
  "{/* New release entries are prepended by `bun run changelog:draft <version> --write`. */}";

const CATEGORY_ORDER = [
  "Breaking Changes",
  "Features",
  "Fixes",
  "Performance",
  "Docs & Examples",
  "Catalog",
  "Internal",
  "Other Changes",
];

type Options = {
  version: string;
  from?: string;
  to?: string;
  date: string;
  write: boolean;
  force: boolean;
};

export type RawCommit = {
  sha: string;
  shortSha: string;
  author: string;
  subject: string;
};

export type ParsedCommit = RawCommit & {
  type: string;
  scope?: string;
  summary: string;
  breaking: boolean;
  category: string;
  prNumber?: string;
};

type DraftOutput = {
  releaseNotes: string;
  docsUpdate: string;
};

type MutableOptions = Omit<Options, "version"> & {
  version?: string;
};

type ValueOptionKey = "from" | "to" | "date";
type BooleanOptionKey = "write" | "force";
type ParsedSubject = Pick<ParsedCommit, "type" | "scope" | "summary" | "breaking">;

const VALUE_OPTIONS = new Map<string, ValueOptionKey>([
  ["--from", "from"],
  ["--to", "to"],
  ["--date", "date"],
]);

const BOOLEAN_OPTIONS = new Map<string, BooleanOptionKey>([
  ["--write", "write"],
  ["--force", "force"],
]);

const INLINE_VALUE_OPTIONS = [
  { prefix: "--from=", key: "from" },
  { prefix: "--to=", key: "to" },
  { prefix: "--date=", key: "date" },
] satisfies Array<InlineValueOption<ValueOptionKey>>;

const TYPE_CATEGORIES = new Map([
  ["feat", "Features"],
  ["fix", "Fixes"],
  ["perf", "Performance"],
]);

const INTERNAL_TYPES = new Set(["build", "chore", "ci", "refactor", "test"]);

function main() {
  const options = parseArgs(process.argv.slice(2));
  const draft = createDraft(options);
  outputDraft(options, draft);
}

function createDraft(options: Options): DraftOutput {
  const versionTag = `v${options.version}`;
  const to = options.to ?? (tagExists(versionTag) ? versionTag : "HEAD");
  const from = options.from ?? resolvePreviousTag(versionTag, to);
  const commits = getCommits(from, to).filter((commit) => !shouldSkipCommit(commit));
  const parsedCommits = commits.map(parseCommit);

  const releaseNotes = renderReleaseNotes(options.version, options.date, from, parsedCommits);
  const docsUpdate = renderDocsUpdate(options.version, options.date, from, parsedCommits);

  return { releaseNotes, docsUpdate };
}

function outputDraft(options: Options, draft: DraftOutput) {
  if (!options.write) {
    console.log(draft.releaseNotes);
    console.log("\n--- Mintlify update block ---\n");
    console.log(draft.docsUpdate);
    console.log(
      "\nRun with --write to create the release file and prepend the docs changelog entry.",
    );
    return;
  }

  writeReleaseNotes(options.version, draft.releaseNotes, options.force);
  prependDocsUpdate(options.version, draft.docsUpdate);
}

export function parseArgs(args: string[]): Options {
  const parsed = createDefaultOptions();

  for (let index = 0; index < args.length; index += 1) {
    index = parseArgument(args, index, parsed);
  }

  return finalizeOptions(parsed);
}

function createDefaultOptions(): MutableOptions {
  return {
    date: new Date().toISOString().slice(0, 10),
    write: false,
    force: false,
  };
}

function parseArgument(args: string[], index: number, parsed: MutableOptions) {
  return parseVersionOptionArgument(args, index, parsed, {
    inlineValueOptions: INLINE_VALUE_OPTIONS,
    valueOptions: VALUE_OPTIONS,
    booleanOptions: BOOLEAN_OPTIONS,
    printUsage,
    fail,
  });
}

function finalizeOptions(parsed: MutableOptions): Options {
  if (!parsed.version) {
    printUsage();
    process.exit(1);
  }

  validateCliVersion(parsed.version, CLI_SEMVER_PATTERN, fail);
  validateCliDate(parsed.date, fail);

  return {
    version: parsed.version,
    from: parsed.from,
    to: parsed.to,
    date: parsed.date,
    write: parsed.write,
    force: parsed.force,
  };
}

function printUsage() {
  console.log(`Usage:
  bun run changelog:draft <version> [--write] [--force] [--from <ref>] [--to <ref>] [--date YYYY-MM-DD]

Examples:
  bun run changelog:draft 0.6.53
  bun run changelog:draft 0.6.53 --write
  bun run changelog:draft 0.6.53 --from v0.6.52 --to HEAD --write
`);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function git(args: string[]) {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf-8",
  }).trim();
}

function tagExists(tag: string) {
  try {
    git(["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`]);
    return true;
  } catch {
    return false;
  }
}

function resolvePreviousTag(versionTag: string, to: string) {
  try {
    if (tagExists(versionTag)) {
      return git(["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", `${versionTag}^`]);
    }
    return git(["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", to]);
  } catch {
    fail("Could not resolve the previous release tag. Pass --from <tag> explicitly.");
  }
}

function getCommits(from: string, to: string): RawCommit[] {
  const output = git(["log", "--format=%H%x09%h%x09%an%x09%s", "--no-merges", `${from}..${to}`]);
  if (!output) {
    return [];
  }

  return output.split("\n").map((line) => {
    const [sha = "", shortSha = "", author = "", ...subjectParts] = line.split("\t");
    return {
      sha,
      shortSha,
      author,
      subject: subjectParts.join("\t"),
    };
  });
}

export function shouldSkipCommit(commit: RawCommit) {
  const subject = commit.subject.toLowerCase();
  return (
    subject.includes("[skip changelog]") ||
    /^chore: release v\d+\.\d+\.\d+/.test(subject) ||
    /^chore: bump version/.test(subject)
  );
}

export function parseCommit(commit: RawCommit): ParsedCommit {
  const prNumber = extractPrNumber(commit.subject);
  const subjectWithoutPr = commit.subject.replace(/\s+\(#\d+\)$/, "");
  const parsedSubject = parseConventionalSubject(subjectWithoutPr);
  const category = categorizeCommit(parsedSubject);

  return {
    ...commit,
    ...parsedSubject,
    category,
    prNumber,
  };
}

export function parseConventionalSubject(subject: string): ParsedSubject {
  const match = /^([a-z]+)(?:\(([^)]+)\))?(!)?:\s+(.+)$/.exec(subject);
  if (!match) {
    return {
      type: "other",
      summary: subject,
      breaking: false,
    };
  }

  return {
    type: match[1],
    scope: match[2],
    summary: match[4],
    breaking: match[3] === "!",
  };
}

function extractPrNumber(subject: string) {
  return /\(#(\d+)\)$/.exec(subject)?.[1];
}

export function categorizeCommit(subject: ParsedSubject) {
  if (subject.breaking) {
    return "Breaking Changes";
  }

  if (isCatalogChange(subject)) {
    return "Catalog";
  }

  return knownCategoryFor(subject) ?? "Other Changes";
}

function isCatalogChange(subject: ParsedSubject) {
  const normalizedScope = subject.scope?.toLowerCase() ?? "";
  const normalizedSummary = subject.summary.toLowerCase();
  return (
    ["catalog", "registry"].includes(normalizedScope) || /catalog|registry/.test(normalizedSummary)
  );
}

function knownCategoryFor(subject: ParsedSubject) {
  return (
    TYPE_CATEGORIES.get(subject.type) ??
    docsCategoryFor(subject) ??
    internalCategoryFor(subject.type)
  );
}

function docsCategoryFor(subject: ParsedSubject) {
  return isDocsChange(subject) ? "Docs & Examples" : undefined;
}

function isDocsChange(subject: ParsedSubject) {
  const normalizedFields = [subject.type, subject.scope?.toLowerCase()];
  return normalizedFields.includes("docs") || subject.summary.toLowerCase().includes("example");
}

function internalCategoryFor(type: string) {
  return INTERNAL_TYPES.has(type) ? "Internal" : undefined;
}

function renderReleaseNotes(version: string, date: string, from: string, commits: ParsedCommit[]) {
  const sections = renderSections(commits, renderCommitBullet);
  const compareUrl = `${REPO_URL}/compare/${from}...v${version}`;

  return [
    `# HyperFrames v${version}`,
    "",
    `Released on ${date}.`,
    "",
    "<!-- TODO: write a 1-2 sentence release summary here. -->",
    "",
    sections,
    "",
    "## Full changelog",
    "",
    compareUrl,
  ].join("\n");
}

function renderDocsUpdate(version: string, date: string, from: string, commits: ParsedCommit[]) {
  const sections = renderSections(commits, renderMdxCommitBullet);
  const compareUrl = `${REPO_URL}/compare/${from}...v${version}`;
  const tags = renderTags(commits);

  return [
    "<Update",
    `  label="HyperFrames v${version}"`,
    `  description="Released - ${date}"`,
    `  tags={${renderTagsLiteral(tags)}}`,
    ">",
    "<!-- TODO: write a 1-2 sentence release summary here. -->",
    "",
    sections,
    "",
    `[View the full commit range](${compareUrl}).`,
    "</Update>",
  ].join("\n");
}

function renderSections(commits: ParsedCommit[], renderBullet: (commit: ParsedCommit) => string) {
  if (commits.length === 0) {
    return "No notable changes were found in the selected commit range.";
  }

  return CATEGORY_ORDER.flatMap((category) => {
    const commitsInCategory = commits.filter((commit) => commit.category === category);
    if (commitsInCategory.length === 0) {
      return [];
    }

    return [`## ${category}`, "", ...commitsInCategory.map(renderBullet), ""];
  })
    .join("\n")
    .trim();
}

export function renderCommitBullet(commit: ParsedCommit) {
  const scope = commit.scope ? `**${formatScope(commit.scope)}:** ` : "";
  const links = [`[${commit.shortSha}](${REPO_URL}/commit/${commit.sha})`];
  if (commit.prNumber) {
    links.push(`[#${commit.prNumber}](${REPO_URL}/pull/${commit.prNumber})`);
  }

  return `- ${scope}${capitalize(commit.summary)} (${links.join(", ")})`;
}

export function renderMdxCommitBullet(commit: ParsedCommit) {
  const scope = commit.scope ? `**${escapeForMdx(formatScope(commit.scope))}:** ` : "";
  const links = [`[${commit.shortSha}](${REPO_URL}/commit/${commit.sha})`];
  if (commit.prNumber) {
    links.push(`[#${commit.prNumber}](${REPO_URL}/pull/${commit.prNumber})`);
  }

  return `- ${scope}${escapeForMdx(capitalize(commit.summary))} (${links.join(", ")})`;
}

function renderTags(commits: ParsedCommit[]) {
  return ["Release", ...uniqueScopeTags(commits).slice(0, 3)];
}

function uniqueScopeTags(commits: ParsedCommit[]) {
  return Array.from(new Set(commits.flatMap(scopeTagsForCommit)));
}

function scopeTagsForCommit(commit: ParsedCommit) {
  return commit.scope ? [formatScope(commit.scope)] : [];
}

export function formatScope(scope: string) {
  const knownScopes = new Map([
    ["api", "API"],
    ["aws", "AWS"],
    ["aws-lambda", "AWS Lambda"],
    ["cli", "CLI"],
    ["core", "Core"],
    ["docs", "Docs"],
    ["engine", "Engine"],
    ["ffmpeg", "FFmpeg"],
    ["producer", "Producer"],
    ["readme", "README"],
    ["studio", "Studio"],
  ]);

  const known = knownScopes.get(scope.toLowerCase());
  if (known) {
    return known;
  }

  return scope
    .split(/[-_]/)
    .map((part) => capitalize(part))
    .join(" ");
}

function capitalize(value: string) {
  if (!value) {
    return value;
  }
  return value[0].toUpperCase() + value.slice(1);
}

function renderTagsLiteral(tags: string[]) {
  return `[${tags.map((tag) => JSON.stringify(tag)).join(", ")}]`;
}

export function escapeForMdx(text: string) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/</g, "\\<")
    .replace(/>/g, "\\>")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}");
}

function writeReleaseNotes(version: string, releaseNotes: string, force: boolean) {
  const releasesDir = join(ROOT, "releases");
  const releasePath = join(releasesDir, `v${version}.md`);
  mkdirSync(releasesDir, { recursive: true });

  // Use an exclusive-write flag rather than a separate existsSync check so the
  // "already exists" guard is atomic with the write (no TOCTOU race).
  // EEXIST is only reachable when force is false (the "wx" flag); with force the
  // "w" flag overwrites and never throws it, so no separate force check is needed.
  try {
    writeFileSync(releasePath, `${releaseNotes}\n`, { flag: force ? "w" : "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      console.log(
        `${releasePath} already exists; leaving it unchanged. Pass --force to overwrite it.`,
      );
      return;
    }
    throw error;
  }
  console.log(`Wrote ${releasePath}`);
}

function prependDocsUpdate(version: string, docsUpdate: string) {
  const changelogPath = join(ROOT, "docs", "changelog.mdx");
  const changelog = readFileSync(changelogPath, "utf-8");

  if (changelog.includes(`label="HyperFrames v${version}"`)) {
    console.log(`docs/changelog.mdx already has a v${version} entry; leaving it unchanged.`);
    return;
  }

  if (!changelog.includes(DOCS_MARKER)) {
    fail(`Could not find insertion marker in ${changelogPath}`);
  }

  const updated = changelog.replace(DOCS_MARKER, `${DOCS_MARKER}\n\n${docsUpdate}`);
  writeFileSync(changelogPath, updated);
  console.log(`Prepended v${version} to ${changelogPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
