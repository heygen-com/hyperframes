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
const TRAILING_PUNCTUATION = /[.,;:!?*_`]+$/;
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
const DOWNLOAD_DEADLINE_MS = 45_000;
const RETRY_DELAYS_MS = [1000, 3000];
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_ASSET_BYTES = 100 * 1024 * 1024;
const MAX_CAPTURES = 12;
const MAX_TOTAL_BYTES = 300 * 1024 * 1024;
/** An attachment redirects to GitHub's own signed-storage bucket; a redirect anywhere else is not followed. */
const TRUSTED_REDIRECT_HOST =
  /^(([a-z0-9-]+\.)*(github\.com|githubusercontent\.com)|github-production-[a-z0-9-]+-asset-[a-z0-9]+\.s3\.amazonaws\.com)$/;

class NonRetryable extends Error {}
/** Our own byte cap tripped: unlike a failed download, this never justifies skipping the check. */
export class LimitExceeded extends NonRetryable {}

/** The next hop of a redirect, refused unless it stays on https and on a GitHub asset host. */
function trustedNextHop(response, current) {
  const next = new URL(response.headers.get("location") ?? "", current);
  if (next.protocol === "https:" && TRUSTED_REDIRECT_HOST.test(next.hostname)) return next.href;
  throw new NonRetryable(`redirected to ${next.hostname}, which is not a GitHub asset host`);
}

/** One GET, following redirects only to hosts that serve GitHub attachments. */
async function fetchTrusted(url, fetchImpl, signal) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetchImpl(current, { redirect: "manual", signal });
    if (!REDIRECT_STATUSES.has(response.status)) return response;
    current = trustedNextHop(response, current);
  }
  throw new NonRetryable("too many redirects");
}

/** Collects chunks, refusing once this asset or the shared budget of the whole check runs out of bytes. */
function cappedCollector(budget) {
  const chunks = [];
  let size = 0;
  return {
    size: () => size,
    bytes: () => Buffer.concat(chunks),
    take(chunk) {
      size += chunk.byteLength;
      budget.left -= chunk.byteLength;
      if (size > MAX_ASSET_BYTES) throw new LimitExceeded(`larger than ${MAX_ASSET_BYTES} bytes`);
      if (budget.left < 0)
        throw new LimitExceeded(`captures together exceed ${MAX_TOTAL_BYTES} bytes`);
      chunks.push(Buffer.from(chunk));
    },
  };
}

async function drainBody(response, take) {
  if (!response.body?.getReader) return take(await response.arrayBuffer());
  const reader = response.body.getReader();
  try {
    for (let part = await reader.read(); !part.done; part = await reader.read()) take(part.value);
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/** The body as bytes; an attempt that fails for any reason but our own cap gives its bytes back. */
async function readCapped(response, budget) {
  const collector = cappedCollector(budget);
  try {
    await drainBody(response, collector.take);
  } catch (error) {
    if (!(error instanceof LimitExceeded)) budget.left += collector.size();
    throw error;
  }
  return collector.bytes();
}

const isRetryableStatus = (status) => status === 429 || status >= 500;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One attempt: the bytes, or a NonRetryable for a final status, or a plain Error for a retryable one. */
async function attemptDownload(url, fetchImpl, signal, budget) {
  const response = await fetchTrusted(url, fetchImpl, signal);
  if (response.ok) return readCapped(response, budget);
  const message = `HTTP ${response.status}`;
  throw isRetryableStatus(response.status) ? new Error(message) : new NonRetryable(message);
}

async function waitForRetry(attempt, sleep, signal) {
  if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);
  if (signal.aborted) throw new NonRetryable(`not finished within ${DOWNLOAD_DEADLINE_MS} ms`);
}

/** The bytes behind a capture URL; a 429, 5xx or network error is retried with backoff, any other status is final. */
export async function downloadAsset(
  url,
  fetchImpl = fetch,
  sleep = pause,
  budget = { left: MAX_TOTAL_BYTES },
) {
  const signal = AbortSignal.timeout(DOWNLOAD_DEADLINE_MS);
  let failure;
  for (let attempt = 0; attempt < DOWNLOAD_ATTEMPTS; attempt++) {
    await waitForRetry(attempt, sleep, signal);
    try {
      return await attemptDownload(url, fetchImpl, signal, budget);
    } catch (error) {
      if (error instanceof NonRetryable) throw error;
      failure = error;
    }
  }
  throw failure;
}

/** Only GitHub attachment URLs are downloaded: a body must not make the runner fetch an arbitrary host. */
const captureUrls = (section) => [
  ...new Set(
    (section.text.match(ANY_URL) ?? [])
      .map((raw) => parseUrl(raw.replace(TRAILING_PUNCTUATION, "")))
      .filter((url) => url !== null && url.protocol === "https:" && isAttachmentUrl(url))
      .map((url) => `${url.origin}${url.pathname}`),
  ),
];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** url -> hash for each capture, read one at a time so one large asset cannot starve a sibling of the shared budget. */
async function hashCaptures(name, urls, download) {
  const hashed = [];
  for (const url of urls) {
    let bytes;
    try {
      bytes = await download(url);
    } catch (error) {
      const problem = `could not download ${name} asset ${url}: ${error.message}`;
      hashed.push({ name, url, problem, refused: error instanceof LimitExceeded });
      continue;
    }
    hashed.push({ name, url, hash: sha256(bytes) });
  }
  return hashed;
}

const noProblems = () => ({ unreadable: [], identical: [], refused: [], notices: [] });

const linkLimitProblem = (urls) =>
  new Set(urls).size > MAX_CAPTURES
    ? {
        ...noProblems(),
        refused: [`more than ${MAX_CAPTURES} capture links; attach fewer, longer clips`],
      }
    : null;

const perCheckDownloader = () => {
  const budget = { left: MAX_TOTAL_BYTES };
  return (url) => downloadAsset(url, fetch, pause, budget);
};

const identicalPairs = (befores, afters) =>
  afters.flatMap((asset) =>
    befores
      .filter((old) => old.hash === asset.hash)
      .map((old) => `After asset ${asset.url} is byte-identical to Before asset ${old.url}`),
  );

async function compareCaptures(beforeUrls, afterUrls, download) {
  const shared = afterUrls.filter((url) => beforeUrls.includes(url));
  const unshared = (urls) => urls.filter((url) => !shared.includes(url));
  const befores = await hashCaptures("Before", unshared(beforeUrls), download);
  const afters = await hashCaptures("After", unshared(afterUrls), download);
  const problems = [...befores, ...afters].filter((asset) => asset.problem);
  const sameLink = shared.map((url) => `After asset ${url} is the same link as a Before asset`);
  return {
    unreadable: problems.filter((asset) => !asset.refused).map((asset) => asset.problem),
    identical: [
      ...sameLink,
      ...identicalPairs(
        befores.filter((asset) => asset.hash),
        afters.filter((asset) => asset.hash),
      ),
    ],
    refused: problems.filter((asset) => asset.refused).map((asset) => asset.problem),
  };
}

const trimmedLinks = (section) =>
  (section.text.match(ANY_URL) ?? []).map((raw) => raw.replace(TRAILING_PUNCTUATION, ""));

/** Media links the hash comparison cannot see: an http attachment is a typo to fix, any other host is only noted. */
function uncomparable(sections) {
  const skipped = sections.flatMap(trimmedLinks).filter(isMediaUrl);
  const comparable = new Set(sections.flatMap(captureUrls));
  const rest = skipped.filter((raw) => !comparable.has(raw.split(/[?#]/)[0]));
  const insecure = rest.filter(
    (raw) => parseUrl(raw)?.protocol === "http:" && isAttachmentUrl(parseUrl(raw)),
  );
  return {
    refused: insecure.map((raw) => `${raw} is an http link; use the https link of the attachment`),
    notices: rest
      .filter((raw) => !insecure.includes(raw))
      .map((raw) => `not compared, not a GitHub attachment: ${raw}`),
  };
}

/** Every After asset must differ by content hash from every Before asset; an unreadable download is a problem. */
export async function duplicateCaptureProblems(body, download = perCheckDownloader()) {
  const sections = parseSections(body);
  const before = findSection(sections, "before");
  const after = findSection(sections, "after");
  if (!before || !after) return noProblems();
  const beforeUrls = captureUrls(before);
  const afterUrls = captureUrls(after);
  const tooMany = linkLimitProblem([...beforeUrls, ...afterUrls]);
  if (tooMany) return tooMany;
  const compared = await compareCaptures(beforeUrls, afterUrls, download);
  const skipped = uncomparable([before, after]);
  return {
    ...compared,
    refused: [...compared.refused, ...skipped.refused],
    notices: skipped.notices,
  };
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

/** A fork's PR runs without secrets, so an unreadable capture there is skipped, never failed. */
export const isFork = (env) => Boolean(env.HEAD_REPO) && env.HEAD_REPO !== env.BASE_REPO;
export const blocking = (unreadable, mustFix, env) =>
  mustFix.length > 0 || (unreadable.length > 0 && !isFork(env));

function printList(heading, problems, out = console.error) {
  if (problems.length === 0) return;
  out(heading);
  for (const problem of problems) out(`  - ${problem}`);
}

function reportCaptureProblems({ unreadable, identical, refused, notices }, env) {
  const skipped =
    "Skipped the duplicate-capture comparison: this PR is from a fork and a capture could not be downloaded without a token, which a fork cannot have.";
  if (isFork(env)) printList(skipped, unreadable, console.log);
  else printList("A capture could not be downloaded to compare:", unreadable);
  printList(
    "A capture under After is the same file as one under Before; re-attach the real After recording:",
    identical,
  );
  printList("The capture comparison hit a limit of this check:", refused);
  printList("Links the duplicate check could not compare:", notices, console.log);
}

const prFromEnv = (env) => ({ body: env.PR_BODY ?? "", number: env.PR_NUMBER ?? "<number>" });
const findProblems = (body, files) =>
  files.length > 0 ? duplicateCaptureProblems(body) : noProblems();

async function main() {
  const args = process.argv.slice(2);
  const numstat = readNumstat(flag(args, "--base", "origin/main"), flag(args, "--head", "HEAD"));
  const { body, number } = prFromEnv(process.env);
  const files = parseNumstat(numstat);
  const { ok, problems } = evaluate({ body, files });
  if (!ok) {
    printFailure(problems, number);
    process.exit(1);
  }
  const found = await findProblems(body, files);
  reportCaptureProblems(found, process.env);
  if (blocking(found.unreadable, [...found.identical, ...found.refused], process.env)) {
    process.exit(1);
  }
  console.log("packages/studio and packages/player: captures present, or nothing to show.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href)
  await main();
