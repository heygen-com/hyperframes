#!/usr/bin/env node
// Step 1 — PR fetch (deterministic; runs gh; large-PR-safe; NO scratch dir).
//
// Replaces a bare `gh pr view … > capture/pr.json` in the orchestrator. It folds
// the PR into the two artifacts ingest.mjs consumes:
//   capture/pr.json    the gh pr view core (title, body, author, refs, commits,
//                      reviews, comments, assignees, +/− stats, …) with its `files`
//                      list COMPLETED via a paginated `gh api .../pulls/N/files`
//                      call — `gh pr view --json files` truncates at ~100 files, so a
//                      big PR would otherwise lose the tail. Commits keep gh pr view's
//                      rich `authors[]` (co-authors) — only `files` needs the override.
//   capture/diff.patch the full unified diff (`gh pr diff`).
//
// gh runs HERE so auth / not-found / private-repo errors surface with gh's own stderr
// and exit 1 (the orchestrator then stops). Intermediates are held in memory — this
// writes ONLY the two files above, so there is no `_ingest_tmp/` scratch to clean up
// (the previous "let the agent fetch in pieces" approach polluted videos/ and was
// non-deterministic). ingest.mjs stays a pure offline transform downstream.
//
// Usage:
//   node fetch-pr.mjs --pr "<url | owner/repo#N | N>" [--out-dir ./capture]
//
// Exit 0 = capture/pr.json + capture/diff.patch written + summary on stdout.
// Exit 1 = gh not authenticated / PR not found / pr view failed.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
};
function die(msg) {
  console.error(`✗ fetch-pr.mjs: ${msg}`);
  process.exit(1);
}

const prRef = flag("pr", null);
if (!prRef) die('--pr "<url | owner/repo#N | N>" is required');
const outDir = resolve(flag("out-dir", "./capture"));

// Run gh, capture stdout. Returns { ok, stdout, stderr } — never throws (callers
// decide whether a failure is fatal). 64 MB buffer covers large diffs / file lists.
function ghTry(args) {
  try {
    const stdout = execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return { ok: true, stdout, stderr: "" };
  } catch (e) {
    return {
      ok: false,
      stdout: (e.stdout || "").toString(),
      stderr: (e.stderr || e.message || "").toString().trim(),
    };
  }
}

// ── 0. auth — fail fast with gh's own hint ───────────────────────────────────
if (!ghTry(["auth", "status"]).ok) {
  die("gh is not authenticated — run: gh auth login");
}

// ── 1. core PR object (gh pr view) ───────────────────────────────────────────
const FIELDS = [
  "number",
  "title",
  "body",
  "author",
  "url",
  "baseRefName",
  "headRefName",
  "commits",
  "files",
  "additions",
  "deletions",
  "changedFiles",
  "labels",
  "reviews",
  "latestReviews",
  "comments",
  "assignees",
  "reviewDecision",
  "mergedBy",
].join(",");

const view = ghTry(["pr", "view", prRef, "--json", FIELDS]);
if (!view.ok) die(`gh pr view "${prRef}" failed (auth / not found / private?):\n${view.stderr}`);

let pr;
try {
  pr = JSON.parse(view.stdout);
} catch (e) {
  die(`gh pr view returned unparseable JSON (${e.message})`);
}

// ── 2. complete the files list via paginated gh api (the truncation fix) ──────
// gh pr view --json files caps at ~100 files; the REST endpoint paginates with no
// cap. --jq runs per page, so the output is NDJSON (one file object per line).
const number = pr.number;
const m = /github\.com\/([^/]+)\/([^/]+)\/pull\/\d+/.exec(pr.url || "");
const owner = m?.[1];
const repo = m?.[2];
let filesNote = `${Array.isArray(pr.files) ? pr.files.length : 0} (from pr view)`;
if (owner && repo && number != null) {
  const apiFiles = ghTry([
    "api",
    "--paginate",
    `repos/${owner}/${repo}/pulls/${number}/files`,
    "--jq",
    ".[] | {path: .filename, additions, deletions, status}",
  ]);
  if (apiFiles.ok) {
    const files = apiFiles.stdout
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    if (files.length) {
      pr.files = files;
      if (pr.changedFiles == null || files.length > pr.changedFiles) pr.changedFiles = files.length;
      filesNote = `${files.length} (completed via gh api)`;
    }
  } else {
    console.error(
      `  (warn: gh api files failed — keeping pr view's files: ${apiFiles.stderr.split("\n")[0]})`,
    );
  }
} else {
  console.error("  (warn: could not parse owner/repo from PR url — keeping pr view's files)");
}

// ── 3. write capture/pr.json + capture/diff.patch ────────────────────────────
mkdirSync(outDir, { recursive: true });
const prJsonPath = join(outDir, "pr.json");
writeFileSync(prJsonPath, JSON.stringify(pr, null, 2) + "\n");

const diff = ghTry(["pr", "diff", prRef]);
const diffPath = join(outDir, "diff.patch");
if (diff.ok) {
  writeFileSync(diffPath, diff.stdout);
} else {
  // The brief still builds without the diff (ingest treats it as optional), so this
  // is a warning, not fatal — but surface it.
  console.error(
    `  (warn: gh pr diff failed — brief builds without it: ${diff.stderr.split("\n")[0]})`,
  );
}

// ── 4. summary ───────────────────────────────────────────────────────────────
const repoLabel = owner && repo ? `${owner}/${repo}` : "(repo?)";
console.log(
  [
    `✓ fetch-pr: ${repoLabel} PR #${number ?? "?"} — "${(pr.title || "").slice(0, 72)}"`,
    `  files: ${filesNote}; diff: ${diff.ok ? `${diff.stdout.length} chars` : "MISSING"}`,
    `  wrote ${prJsonPath}${diff.ok ? ` + ${diffPath}` : ""}`,
  ].join("\n"),
);
