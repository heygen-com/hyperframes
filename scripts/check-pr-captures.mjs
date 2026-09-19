#!/usr/bin/env node
// Fail a PR touching packages/studio or packages/player unless its body has Before and After sections with media.
// usage: node scripts/check-pr-captures.mjs --base origin/main --head <sha>; the body arrives in the env (see main).

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const WATCHED_PREFIXES = ["packages/studio/", "packages/player/"];
export const NO_VISIBLE_CHANGE_MAX_LINES = 20;
export const VISUAL_EXTENSIONS = [".tsx", ".css", ".html"];

const MEDIA_PATH = /\.(?:png|jpe?g|gif|webp|svg|mp4|mov|webm)$/i;
const ATTACHMENT_PATH = /^\/user-attachments\/assets\/[\w-]+/;
const IMAGE_EMBED =
  /!\[[^\]]*\]\(\s*https?:\/\/|<(?:img|video|source)\b[^>]*\bsrc=["']https?:\/\//i;
const ANY_URL = /https?:\/\/[^\s)"'<>\]]+/gi;

function parseUrl(raw) {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

const isAttachmentUrl = (url) =>
  url.hostname === "github.com" && ATTACHMENT_PATH.test(url.pathname);

function isMediaUrl(raw) {
  const url = parseUrl(raw);
  return url !== null && (isAttachmentUrl(url) || MEDIA_PATH.test(url.pathname));
}

const TEST_FILE = /\.(?:test|spec)\.[jt]sx?$/;

const CAPTURE_TITLES = {
  before: /^before(?:\s*[:(].*|\s+[-–—]\s.*)?$/i,
  after: /^after(?:\s*[:(].*|\s+[-–—]\s.*)?$/i,
  noVisibleChange: /^no visible change\b/i,
};

const isCapture = (title) => Object.values(CAPTURE_TITLES).some((re) => re.test(title));

const SETEXT = [
  [/^=+\s*$/, "#"],
  [/^-{2,}\s*$/, "##"],
];

/** GitHub hides an unclosed comment to the end of the body; repeat so removal cannot join fragments into a new one. */
function stripComments(body) {
  let text = body;
  let previous;
  do {
    previous = text;
    text = text.replace(/<!--[\s\S]*?(?:-->|$)/g, "");
  } while (text !== previous);
  return text;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

const closesFence = (open, line) => {
  const [, marker = "", rest = ""] = FENCE.exec(line) ?? [];
  return marker[0] === open[0] && marker.length >= open.length && rest.trim() === "";
};

const openingMarker = (line) => FENCE.exec(line)?.[1] ?? null;

/** The open fence marker after this line (CommonMark: same character, at least as long, to close), or null. */
const nextFence = (open, line) => {
  if (open) return closesFence(open, line) ? null : open;
  return openingMarker(line);
};

function blankFences(lines) {
  let open = null;
  return lines.map((line) => {
    const before = open;
    open = nextFence(open, line);
    return before || open ? "" : line;
  });
}

const setextPrefix = (underline) => SETEXT.find(([re]) => re.test(underline))?.[1];

function promoteSetext(lines) {
  const padded = [...lines, ""];
  return lines.map((line, i) => {
    const prefix = isCapture(line.trim()) ? setextPrefix(padded[i + 1]) : undefined;
    return prefix ? `${prefix} ${line.trim()}` : line;
  });
}

/** Drop HTML comments and fenced code, and promote setext capture headings, so none can fake a section. */
const normalize = (body) => promoteSetext(blankFences(stripComments(body).split(/\r?\n/)));

/** Sections run to the next heading of the same or a higher level, or to the next capture heading. */
export function parseSections(body) {
  const lines = normalize(body);
  const headings = [];
  lines.forEach((line, index) => {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) headings.push({ level: match[1].length, title: match[2].trim(), index });
  });
  return headings.map((heading, i) => {
    const end = headings
      .slice(i + 1)
      .find((next) => next.level <= heading.level || isCapture(next.title));
    return {
      title: heading.title,
      text: lines.slice(heading.index + 1, end ? end.index : lines.length).join("\n"),
    };
  });
}

export function hasMedia(text) {
  return IMAGE_EMBED.test(text) || (text.match(ANY_URL) ?? []).some(isMediaUrl);
}

function findSection(sections, name) {
  return sections.find((section) => CAPTURE_TITLES[name].test(section.title));
}

function parseRecord(record) {
  const [added, deleted, ...rest] = record.split("\t");
  const binary = added === "-" || deleted === "-";
  const lines = binary ? NO_VISIBLE_CHANGE_MAX_LINES : Number(added) + Number(deleted);
  return { path: rest.join("\t"), lines };
}

const isWatched = (path) =>
  path !== "" && WATCHED_PREFIXES.some((prefix) => path.startsWith(prefix));

/** Parse `git diff --numstat -z --no-renames`, keeping watched paths. A binary file counts as a full budget. */
export const parseNumstat = (numstat) =>
  numstat
    .split("\0")
    .map(parseRecord)
    .filter((file) => isWatched(file.path));

const isVisualFile = (path) =>
  VISUAL_EXTENSIONS.some((ext) => path.endsWith(ext)) && !TEST_FILE.test(path);

/** Why a "No visible change" declaration does not hold for this diff; empty means it holds. */
export function noVisibleChangeFailures(files) {
  const failures = [];
  const lines = files.reduce((sum, file) => sum + file.lines, 0);
  if (lines >= NO_VISIBLE_CHANGE_MAX_LINES) {
    failures.push(
      `the diff changes ${lines} lines under packages/studio and packages/player; the limit is under ${NO_VISIBLE_CHANGE_MAX_LINES}`,
    );
  }
  const visual = files.filter((file) => isVisualFile(file.path));
  if (visual.length > 0) {
    failures.push(
      `the diff touches ${VISUAL_EXTENSIONS.join(", ")} files: ${visual.map((file) => file.path).join(", ")}`,
    );
  }
  return failures;
}

function sectionProblem(section, name) {
  if (!section) return `the body has no "${name}" heading`;
  return hasMedia(section.text) ? null : `the "${name}" section has no image or video`;
}

const captureProblems = (sections) =>
  [
    sectionProblem(findSection(sections, "before"), "Before"),
    sectionProblem(findSection(sections, "after"), "After"),
  ].filter(Boolean);

function noVisibleChangeVerdict(sections, files) {
  if (!findSection(sections, "noVisibleChange")) return { holds: false, problems: [] };
  const failures = noVisibleChangeFailures(files);
  const problems = failures.map((failure) => `"No visible change" does not apply: ${failure}`);
  return { holds: failures.length === 0, problems };
}

const PASS = { ok: true, problems: [] };

export function evaluate({ body, files }) {
  if (files.length === 0) return PASS;
  const sections = parseSections(body);
  const captures = captureProblems(sections);
  if (captures.length === 0) return PASS;
  const verdict = noVisibleChangeVerdict(sections, files);
  if (verdict.holds) return PASS;
  return { ok: false, problems: [...verdict.problems, ...captures] };
}

const DOWNLOAD_ATTEMPTS = 3;
const DOWNLOAD_TIMEOUT_MS = 30_000;

/** The bytes behind a capture URL; retried, because a required check must not flake on one bad response. */
export async function downloadAsset(url, fetchImpl = fetch) {
  let failure;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
    try {
      const response = await fetchImpl(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
      if (response.ok) return Buffer.from(await response.arrayBuffer());
      failure = new Error(`HTTP ${response.status}`);
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
}

const captureUrls = (section) => [
  ...new Set((section.text.match(ANY_URL) ?? []).filter(isMediaUrl)),
];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** url -> hash for every capture in a section, or a problem for each one that could not be read. */
async function hashCaptures(name, section, download) {
  return Promise.all(
    captureUrls(section).map(async (url) => {
      try {
        return { name, url, hash: sha256(await download(url)) };
      } catch (error) {
        return { name, url, problem: `could not download ${name} asset ${url}: ${error.message}` };
      }
    }),
  );
}

/** Every After asset must differ by content hash from every Before asset; an unreadable download is a problem. */
export async function duplicateCaptureProblems(body, download = downloadAsset) {
  const sections = parseSections(body);
  const before = findSection(sections, "before");
  const after = findSection(sections, "after");
  if (!before || !after) return [];
  const [befores, afters] = await Promise.all([
    hashCaptures("Before", before, download),
    hashCaptures("After", after, download),
  ]);
  const unreadable = [...befores, ...afters].filter((asset) => asset.problem);
  const hashedBefores = befores.filter((asset) => asset.hash);
  const identical = afters
    .filter((asset) => asset.hash)
    .flatMap((asset) =>
      hashedBefores
        .filter((old) => old.hash === asset.hash)
        .map((old) => `After asset ${asset.url} is byte-identical to Before asset ${old.url}`),
    );
  return [...unreadable.map((asset) => asset.problem), ...identical];
}

export function attachCommand(prNumber) {
  return `gh pr edit ${prNumber} --attach ./before.png --attach ./after.png`;
}

function flag(args, name, fallback) {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args[at + 1];
}

function readNumstat(base, head) {
  try {
    return execFileSync("git", ["diff", "--numstat", "-z", "--no-renames", `${base}...${head}`], {
      encoding: "utf8",
    });
  } catch (error) {
    console.error(`cannot diff ${base}...${head}: ${error.message.trim()}`);
    return process.exit(2);
  }
}

function printFailure(problems, prNumber) {
  console.error(
    "This PR changes packages/studio or packages/player, so its body must show the behaviour.",
  );
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("\nAdd '## Before' and '## After' sections, each with an image or video, then:");
  console.error(`  ${attachCommand(prNumber)}`);
  console.error("Only the PR description counts; captures posted as comments are not read.");
  console.error(
    "Edit the body text first: gh pr edit --body-file replaces the body and drops attachments.",
  );
  console.error(
    `A change with no visible effect (under ${NO_VISIBLE_CHANGE_MAX_LINES} lines, no .tsx/.css/.html) may instead add a '## No visible change' section.`,
  );
}

async function main() {
  const args = process.argv.slice(2);
  const numstat = readNumstat(flag(args, "--base", "origin/main"), flag(args, "--head", "HEAD"));
  const body = process.env.PR_BODY ?? "";
  const files = parseNumstat(numstat);
  const { ok, problems } = evaluate({ body, files });
  if (!ok) {
    printFailure(problems, process.env.PR_NUMBER ?? "<number>");
    process.exit(1);
  }
  const duplicates = files.length > 0 ? await duplicateCaptureProblems(body) : [];
  if (duplicates.length > 0) {
    console.error("A capture under After is the same file as one under Before:");
    for (const problem of duplicates) console.error(`  - ${problem}`);
    console.error("Re-attach the real After recording; a Before clip under After proves nothing.");
    process.exit(1);
  }
  console.log("packages/studio and packages/player: captures present, or nothing to show.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href)
  await main();
