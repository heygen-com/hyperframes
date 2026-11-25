#!/usr/bin/env node
// Says whether a pull request changes only a release's own files: manifest versions, release notes, the changelog.
//   node scripts/ci/release-only-diff.mjs [--base <ref>] [--verify]; writes release_only= to $GITHUB_OUTPUT
// --verify also exits 1 on mixed versions, missing notes, an unreviewed TODO or a missing changelog entry.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { releaseVersionOf, skipsChangelog } from "../changelog-skip.mjs";

const MANIFESTS = new Set(["package.json", "plugin.json", "gemini-extension.json"]);
const RELEASE_NOTES = /^releases\/v\d+\.\d+\.\d+[^/]*\.md$/;
const CHANGELOG = "docs/changelog.mdx";
const UNREVIEWED = ["<!-- TODO: write a 1-2 sentence release summary here. -->", "<!-- Style bar:"];

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The manifest with its version taken out, or null when it is not JSON. */
function withoutVersion(text) {
  try {
    const { version, ...rest } = JSON.parse(text);
    return { version, rest };
  } catch {
    return null;
  }
}

/** `{ from, to }` when the only difference between two manifest texts is `version`, else null. */
function versionBump(was, now) {
  const a = was === null ? null : withoutVersion(was);
  const b = now === null ? null : withoutVersion(now);
  return a && b && sameJson(a.rest, b.rest) && a.version !== b.version
    ? { from: a.version, to: b.version }
    : null;
}

/** Sorts changed paths into the release's own and the rest; before and after read a path at each end, or null. */
export function classify(paths, before, after) {
  const other = [];
  const versions = new Map();
  const previous = new Set();
  for (const path of paths) {
    if (RELEASE_NOTES.test(path) || path === CHANGELOG) continue;
    const bumped = MANIFESTS.has(basename(path)) ? versionBump(before(path), after(path)) : null;
    if (bumped === null) other.push(path);
    else {
      versions.set(path, bumped.to);
      previous.add(bumped.from);
    }
  }
  return { releaseOnly: versions.size > 0 && other.length === 0, other, versions, previous };
}

/** The commits in `commits` ({ sha, subject }) that release notes should list but do not link. */
export function unlistedCommits(commits, notes) {
  return commits.filter(({ sha, subject }) => !skipsChangelog(subject) && !notes.includes(sha));
}

/** A conventional `type(scope)!:` subject. Only the `!` is read: this repo marks breaking changes in the subject. */
const BREAKING_SUBJECT = /^[a-z]+(?:\([^)]+\))?!:/;

/** The commits still in effect, newest first: a later commit in effect that names one as reverted takes it out. */
function inEffect(commits) {
  const reverted = [];
  return commits.filter(({ sha, body = "" }) => {
    if (reverted.some((ref) => sha.startsWith(ref))) return false;
    for (const [, ref] of body.matchAll(/This reverts commit ([0-9a-f]{7,40})/g))
      reverted.push(ref);
    return true;
  });
}

/** The version a breaking change needs after `from`: the next minor below 1.0, the next major from 1.0 on. */
function breakingVersionAfter(from) {
  const [major, minor] = from.split(".").map(Number);
  return major === 0 ? `0.${minor + 1}.0` : `${major + 1}.0.0`;
}

/** Whether `to` is at least the version a breaking change needs after `from`. */
function allowsBreaking(from, to) {
  const needed = breakingVersionAfter(from).split(".").map(Number);
  const got = to.split(".").map((part) => Number.parseInt(part, 10));
  for (let i = 0; i < 3; i++) if (got[i] !== needed[i]) return got[i] > needed[i];
  return true;
}

/** The problem when an unreverted breaking change since the last release rides a bump below the one it needs. */
function breakingBumpProblems(from, version, commits) {
  const breaking = inEffect(commits).find(({ subject }) => BREAKING_SUBJECT.test(subject));
  if (!breaking || !from || allowsBreaking(from, version)) return [];
  return [
    `v${version} is too small a bump for a breaking change: ` +
      `${breaking.sha.slice(0, 9)} ${breaking.subject}. ` +
      `Release it as v${breakingVersionAfter(from)}, or revert the change first.`,
  ];
}

function notesProblems(version, notes, commits) {
  if (notes === null) return [`releases/v${version}.md is missing`];
  const problems = [];
  if (UNREVIEWED.some((marker) => notes.includes(marker)))
    problems.push(`releases/v${version}.md still has the generated TODO or style note`);
  const unlisted = unlistedCommits(commits, notes);
  if (unlisted.length)
    problems.push(
      `releases/v${version}.md misses ${unlisted.length} commit(s) merged since the notes were drafted: ` +
        unlisted.map(({ sha, subject }) => `${sha.slice(0, 9)} ${subject}`).join("; ") +
        ". Link each in the notes, or rebase on main and rerun `bun run release:prepare` if main moved.",
    );
  return problems;
}

function changelogProblems(version, changelog) {
  if (changelog === null || !changelog.includes(`label="HyperFrames v${version}"`))
    return [`${CHANGELOG} has no entry for v${version}`];
  if (UNREVIEWED.some((marker) => changelog.includes(marker)))
    return [`${CHANGELOG} still has the generated TODO or style note`];
  return [];
}

/** Problems with a release that is otherwise only versions and notes; empty when it is consistent. */
export function verifyRelease({ versions, previous = new Set() }, after, commits = []) {
  const distinct = new Set(versions.values());
  if (distinct.size !== 1)
    return [`manifests move to different versions: ${[...distinct].join(", ") || "none changed"}`];
  if (previous.size > 1)
    return [`manifests move from different versions: ${[...previous].join(", ")}`];
  const [version] = distinct;
  const [from] = previous;
  return [
    ...breakingBumpProblems(from, version, commits),
    ...notesProblems(version, after(`releases/v${version}.md`), commits),
    ...changelogProblems(version, after(CHANGELOG)),
  ];
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 26 });
const show = (ref) => (path) => {
  try {
    return git("show", `${ref}:${path}`);
  } catch {
    return null;
  }
};

/** The commits between the last release commit and `base`, newest first; empty when `base` holds no earlier release. */
function commitsSinceLastRelease(base) {
  const last = git("log", "--format=%H%x09%s", base)
    .split("\n")
    .find((line) => releaseVersionOf(line.split("\t").slice(1).join("\t")) !== null)
    ?.split("\t")[0];
  if (!last) return [];
  return git("log", "--no-merges", "--format=%H%x1f%s%x1f%b%x1e", `${last}..${base}`)
    .split("\x1e")
    .filter((record) => record.trim())
    .map((record) => {
      const [sha, subject, body] = record.trim().split("\x1f");
      return { sha, subject, body };
    });
}

function main(argv) {
  const at = argv.indexOf("--base");
  const base = at >= 0 ? argv[at + 1] : "HEAD^1";
  const paths = git("-c", "core.quotePath=false", "diff", "--name-only", `${base}..HEAD`)
    .split("\n")
    .filter(Boolean);
  const result = classify(paths, show(base), show("HEAD"));
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `release_only=${result.releaseOnly}\n`);
  console.log(
    result.releaseOnly
      ? `release only: ${paths.length} files, versions and notes`
      : `not release only: ${result.other.slice(0, 5).join(", ") || "no changed files"}`,
  );
  if (!argv.includes("--verify")) return 0;
  if (!result.releaseOnly) {
    console.error(
      "--verify applies to a release diff; this one carries more than versions and notes.",
    );
    return 1;
  }
  const problems = verifyRelease(result, show("HEAD"), commitsSinceLastRelease(base));
  for (const problem of problems) console.error(`::error::${problem}`);
  return problems.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exit(main(process.argv.slice(2)));
