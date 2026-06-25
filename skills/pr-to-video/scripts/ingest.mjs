#!/usr/bin/env node
// Step 1 — PR ingest (deterministic; no subagent; NO network).
//
// Pure transform. The orchestrator (SKILL.md Step 1) runs `gh` itself so auth /
// not-found / private-repo errors surface with gh's own stderr; THIS script never
// touches the network. It only folds the two gh artifacts into the synthetic
// capture package the shared Gen-B backend (build-frame / captions / assemble-index)
// expects — the same shape faceless-explainer's Step 1 writes by hand, so the
// whole downstream runs unchanged. `capture/extracted/` is kept (no website was
// captured — the PR is ingested into the same folder the engine reads by default).
//
// Reads:
//   --pr-json <path>   gh pr view --json number,title,body,author,url,baseRefName,
//                      headRefName,commits,files,additions,deletions,changedFiles,labels,
//                      reviews,latestReviews,comments,assignees,reviewDecision,mergedBy
//   --diff <path>      gh pr diff (raw unified diff)  [optional — brief still builds without it]
// Writes (under --out-dir, default ./capture/extracted):
//   tokens.json        synthetic design tokens (colors:[] → claude native palette)
//   visible-text.txt   the narrative SOURCE: a readable plain-text brief assembled
//                      from title + meta + people + body + commits + changed files + a
//                      budget-bounded selection of representative diff hunks.
//   people.json        the contributors (PR author / commit authors / reviewers /
//                      commenters / assignees — the PR `author` is only the opener, so
//                      commit authors from commits[].authors[] are tracked separately),
//                      bot-filtered + deduped, each with a GitHub avatar URL + intended
//                      assets/<login>.png path. The avatars themselves are
//                      downloaded by the orchestrator (fetch-people-avatars.mjs) — THIS
//                      script stays offline. people.json + the avatars are the ONE place
//                      the faceless default is relaxed: an optional credits/shipped-by close.
//
// The story-design subagent reads visible-text.txt for the narrative AND gets the
// full diff.patch separately for deep hunk selection — so this brief is curated,
// not exhaustive: noisy files (lockfiles / dist / maps) are deprioritised so real
// source hunks win the char budget.
//
// Usage:
//   node ingest.mjs --pr-json ./capture/pr.json --diff ./capture/diff.patch \
//                   --out-dir ./capture/extracted
//
// Exit 0 = tokens.json + visible-text.txt written + summary on stdout.
// Exit 1 = pr.json missing / unparseable (orchestrator should stop).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

// ---------- argv ----------
const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
};
function die(msg) {
  console.error(`✗ ingest.mjs: ${msg}`);
  process.exit(1);
}

const prJsonPath = resolve(flag("pr-json", "./capture/pr.json"));
const diffPath = flag("diff") ? resolve(flag("diff")) : resolve("./capture/diff.patch");
const outDir = resolve(flag("out-dir", "./capture/extracted"));

// Budgets — keep visible-text.txt readable and bounded for the story-design agent.
const MAX_BODY_CHARS = parseInt(flag("max-body-chars", "2600"), 10);
const MAX_DIFF_CHARS = parseInt(flag("max-diff-chars", "4800"), 10);
const MAX_HUNK_LINES = parseInt(flag("max-hunk-lines", "22"), 10); // per hunk, post-context-trim
const MAX_COMMITS = parseInt(flag("max-commits", "12"), 10);
const MAX_FILES_LISTED = parseInt(flag("max-files-listed", "40"), 10);

// Noisy paths whose diff bodies rarely teach anything — deprioritised in hunk
// selection (still listed in "Files changed" with their stats).
const NOISE_RX =
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|npm-shrinkwrap\.json|go\.sum|Cargo\.lock|composer\.lock|Gemfile\.lock|poetry\.lock)$|\.(min\.js|min\.css|map|snap)$|(^|\/)(dist|build|out|vendor|node_modules|\.next|coverage)\//;

// ---------- read pr.json ----------
if (!existsSync(prJsonPath)) die(`pr.json not found at ${prJsonPath} (run gh pr view first)`);
let pr;
try {
  pr = JSON.parse(readFileSync(prJsonPath, "utf8"));
} catch (e) {
  die(`pr.json is not valid JSON (${e.message}) — check the gh pr view output`);
}

// ---------- read diff (optional) ----------
let diffRaw = "";
if (existsSync(diffPath)) {
  try {
    diffRaw = readFileSync(diffPath, "utf8");
  } catch {
    diffRaw = "";
  }
}

// ---------- derive scalars ----------
const number = pr.number ?? "?";
const title = (pr.title || `Pull request #${number}`).trim();
const url = pr.url || "";
const repo = (() => {
  const m = /github\.com\/([^/]+\/[^/]+)\/pull\//.exec(url);
  if (m) return m[1];
  if (pr.headRepository?.nameWithOwner) return pr.headRepository.nameWithOwner;
  return "";
})();
const author = pr.author?.login || pr.author?.name || "unknown";
const baseRef = pr.baseRefName || "base";
const headRef = pr.headRefName || "head";
const additions = pr.additions ?? 0;
const deletions = pr.deletions ?? 0;
const changedFiles = pr.changedFiles ?? (Array.isArray(pr.files) ? pr.files.length : 0);
const labels = Array.isArray(pr.labels)
  ? pr.labels.map((l) => (typeof l === "string" ? l : l?.name)).filter(Boolean)
  : [];

// ---------- people (author / reviewers / commenters / assignees) ----------
// Offline bot heuristic — gh gives reviewer/commenter authors as a bare `login`
// (no `is_bot`), so we filter by the GitHub `[bot]` suffix + a denylist of the
// review/CI bots that dominate org PRs. Best-effort: a bot that slips through
// just gets an avatar downloaded and can still be excluded by story-design.
const BOT_DENYLIST = new Set(
  [
    "claude",
    "graphite-app",
    "dependabot",
    "github-actions",
    "codecov",
    "codecov-commenter",
    "coderabbitai",
    "sonarcloud",
    "sonarqubecloud",
    "vercel",
    "netlify",
    "renovate",
    "snyk-bot",
    "greenkeeper",
    "mergify",
    "allcontributors",
    "imgbot",
    "pre-commit-ci",
    "deepsource-autofix",
    "sentry-io",
    "semgrep-app",
    "cubic-dev-ai",
    "gemini-code-assist",
    "copilot-pull-request-reviewer",
    "github-advanced-security",
    "restyled-io",
    "changeset-bot",
    "bundlemon",
  ].map((s) => s.toLowerCase()),
);
const isBot = (login) => {
  if (!login) return true;
  const l = login.toLowerCase();
  return l.endsWith("[bot]") || l.endsWith("-bot") || l.endsWith("[robot]") || BOT_DENYLIST.has(l);
};

// "author" = the PR opener; "committer" = wrote/co-authored commits in this PR
// (often differs from the opener — a teammate force-pushes the branch, or commits
// are co-authored). Commit authors are first-class contributors for a credits close.
const ROLE_ORDER = ["author", "committer", "reviewer", "commenter", "assignee"];
const peopleMap = new Map(); // login -> { login, roles:Set, reviewState, association, commitCount }
const botsFiltered = new Set();
// Returns the person record for a real (non-bot) login, creating it on first
// touch; records and drops bots. null means "skip this login".
function consider(login) {
  if (!login) return null;
  if (isBot(login)) {
    botsFiltered.add(login);
    return null;
  }
  if (!peopleMap.has(login))
    peopleMap.set(login, {
      login,
      roles: new Set(),
      reviewState: null,
      association: null,
      commitCount: 0,
    });
  return peopleMap.get(login);
}

const authorLogin = pr.author?.login || null;
{
  const p = consider(authorLogin);
  if (p) p.roles.add("author");
}

// Commit authors — the people who actually wrote the code. pr.commits[].authors[]
// carries login/name/email; co-authored commits list several. Counts drive ordering
// and the brief ("@login (N commits)"). Authors with no GitHub login (email-only)
// can't be avatar'd, so they're skipped here.
for (const c of Array.isArray(pr.commits) ? pr.commits : []) {
  for (const a of Array.isArray(c?.authors) ? c.authors : []) {
    const p = consider(a?.login);
    if (!p) continue;
    p.roles.add("committer");
    p.commitCount += 1;
  }
}

// Reviewers — prefer latestReviews (one row per reviewer, final state); fall back
// to reviews[] (all events → keep the last state per reviewer).
let reviewSource = Array.isArray(pr.latestReviews) ? pr.latestReviews : [];
if (!reviewSource.length && Array.isArray(pr.reviews)) {
  const lastByAuthor = new Map();
  for (const r of pr.reviews) {
    const lg = r?.author?.login;
    if (lg) lastByAuthor.set(lg, r); // later events overwrite earlier
  }
  reviewSource = [...lastByAuthor.values()];
}
for (const r of reviewSource) {
  const p = consider(r?.author?.login);
  if (!p) continue;
  p.roles.add("reviewer");
  if (r.state) p.reviewState = r.state;
  if (r.authorAssociation) p.association = r.authorAssociation;
}

for (const c of Array.isArray(pr.comments) ? pr.comments : []) {
  const p = consider(c?.author?.login);
  if (p) p.roles.add("commenter");
}
for (const a of Array.isArray(pr.assignees) ? pr.assignees : []) {
  const p = consider(a?.login);
  if (p) p.roles.add("assignee");
}

const REVIEW_STATE_LABEL = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes requested",
  COMMENTED: "commented",
  DISMISSED: "dismissed",
  PENDING: "pending",
};
const primaryRoleRank = (roles) => {
  for (let i = 0; i < ROLE_ORDER.length; i++) if (roles.includes(ROLE_ORDER[i])) return i;
  return ROLE_ORDER.length;
};
const people = [...peopleMap.values()]
  .map((p) => ({
    login: p.login,
    roles: ROLE_ORDER.filter((r) => p.roles.has(r)),
    commitCount: p.commitCount || 0,
    reviewState: p.reviewState || null,
    association: p.association || null,
    // Unauthenticated avatar endpoint — redirects to the user's avatar; the
    // orchestrator's fetch-people-avatars.mjs downloads it here.
    avatarUrl: `https://github.com/${encodeURIComponent(p.login)}.png?size=200`,
    avatarFile: `assets/${p.login}.png`,
    avatarFetched: false, // set true by fetch-people-avatars.mjs once downloaded
  }))
  .sort((a, b) => primaryRoleRank(a.roles) - primaryRoleRank(b.roles));

const reviewDecision = pr.reviewDecision || null;
const mergedByLogin = pr.mergedBy?.login || null;

// ---------- clean body ----------
function cleanBody(raw) {
  if (!raw || typeof raw !== "string") return "";
  // Strip HTML comments (PR templates) to a fixpoint, so fragments left by one
  // pass can't reassemble into a new comment (CodeQL
  // js/incomplete-multi-character-sanitization).
  let t = raw;
  for (let prev = null; prev !== t; ) {
    prev = t;
    t = t.replace(/<!--[\s\S]*?-->/g, "");
  }
  t = t
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (t.length > MAX_BODY_CHARS) {
    t = t.slice(0, MAX_BODY_CHARS).replace(/\s+\S*$/, "") + "\n…(description truncated)";
  }
  return t;
}
const body = cleanBody(pr.body);

// ---------- commits ----------
const commits = Array.isArray(pr.commits) ? pr.commits : [];
const commitLines = commits
  .map(
    (c) =>
      c?.messageHeadline || (c?.messageBody || "").split("\n")[0] || (c?.oid || "").slice(0, 7),
  )
  .filter(Boolean);

// ---------- files (from pr.json) ----------
const files = (Array.isArray(pr.files) ? pr.files : []).map((f) => ({
  path: f.path || f.filename || "",
  additions: f.additions ?? 0,
  deletions: f.deletions ?? 0,
}));

// ---------- parse the unified diff into per-file hunks ----------
function parseDiff(raw) {
  if (!raw) return new Map();
  const lines = raw.split("\n");
  const byPath = new Map(); // path -> { hunks: string[][] }
  let curPath = null;
  let curHunk = null;
  const ensure = (p) => {
    if (!byPath.has(p)) byPath.set(p, { hunks: [] });
    return byPath.get(p);
  };
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      // new file block; provisional path from "b/<path>" (refined by +++ below)
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      curPath = m ? m[2] : null;
      curHunk = null;
      if (curPath) ensure(curPath);
      continue;
    }
    if (line.startsWith("+++ ")) {
      // authoritative new path ("+++ b/path" or "+++ /dev/null" for deletions)
      const p = line.slice(4).replace(/^b\//, "").trim();
      if (p && p !== "/dev/null") {
        curPath = p;
        ensure(curPath);
      }
      continue;
    }
    if (line.startsWith("--- ")) continue;
    if (line.startsWith("@@")) {
      if (!curPath) continue;
      curHunk = [line];
      ensure(curPath).hunks.push(curHunk);
      continue;
    }
    if (curHunk && curPath) {
      // body line of the current hunk (context / + / -); ignore the trailing
      // "\ No newline at end of file" sentinel
      if (line.startsWith("\\")) continue;
      curHunk.push(line);
    }
  }
  return byPath;
}
const diffByPath = parseDiff(diffRaw);

// Render a single hunk, trimmed: keep the @@ header + all +/- lines, but cap
// surrounding context to keep signal high and stay inside the line budget.
function renderHunk(hunk) {
  const header = hunk[0];
  const bodyLines = hunk.slice(1);
  const kept = [];
  for (const l of bodyLines) {
    if (l.startsWith("+") || l.startsWith("-")) kept.push(l);
    else if (kept.length && kept[kept.length - 1] !== "  ⋯") {
      // collapse runs of context into a single marker (only between changes)
      if (kept.some((k) => k.startsWith("+") || k.startsWith("-"))) kept.push("  ⋯");
    }
  }
  // drop a trailing context marker
  while (kept.length && kept[kept.length - 1] === "  ⋯") kept.pop();
  let out = [header.replace(/\s*$/, "")];
  out = out.concat(kept.slice(0, MAX_HUNK_LINES));
  if (kept.length > MAX_HUNK_LINES)
    out.push(`  …(+${kept.length - MAX_HUNK_LINES} more changed lines)`);
  return out.join("\n");
}

// ---------- rank files for the representative-diff section ----------
// real source first (non-noise, by total churn desc), noisy files last.
const ranked = [...files]
  .filter((f) => f.path && diffByPath.has(f.path))
  .sort((a, b) => {
    const an = NOISE_RX.test(a.path) ? 1 : 0;
    const bn = NOISE_RX.test(b.path) ? 1 : 0;
    if (an !== bn) return an - bn;
    return b.additions + b.deletions - (a.additions + a.deletions);
  });
// include any diffed paths missing from files[] (rare; e.g. renames) at the tail
for (const p of diffByPath.keys()) {
  if (!ranked.find((f) => f.path === p)) ranked.push({ path: p, additions: 0, deletions: 0 });
}

// ---------- build the representative-diff section under the char budget ----------
const diffSections = [];
let diffChars = 0;
let filesShown = 0;
let filesOmitted = 0;
for (const f of ranked) {
  const entry = diffByPath.get(f.path);
  if (!entry || !entry.hunks.length) continue;
  const head = `### ${f.path}  (+${f.additions} / -${f.deletions})`;
  const rendered = entry.hunks.map(renderHunk).join("\n");
  const block = `${head}\n${rendered}`;
  if (diffChars + block.length > MAX_DIFF_CHARS && filesShown > 0) {
    filesOmitted++;
    continue;
  }
  diffSections.push(block);
  diffChars += block.length;
  filesShown++;
}

// ---------- assemble visible-text.txt ----------
const lines = [];
lines.push(`# ${title}`);
lines.push("");
const metaBits = [repo, `PR #${number}`, `by ${author}`].filter(Boolean);
lines.push(metaBits.join(" · "));
lines.push(
  `${baseRef} ← ${headRef} · +${additions} / -${deletions} across ${changedFiles} file(s)`,
);
if (labels.length) lines.push(`Labels: ${labels.join(", ")}`);
if (url) lines.push(`URL: ${url}`);
lines.push("");

// People & reviews — human context for an optional credits / shipped-by close.
// Avatars land in assets/<login>.png (downloaded by the orchestrator).
if (people.length) {
  lines.push("## People & reviews");
  const authorPerson = people.find((p) => p.roles.includes("author"));
  if (authorPerson) lines.push(`Author (opened PR): @${authorPerson.login}`);
  const committers = people.filter((p) => p.roles.includes("committer"));
  if (committers.length) {
    const parts = committers
      .slice()
      .sort((a, b) => b.commitCount - a.commitCount)
      .map(
        (p) =>
          `@${p.login}${p.commitCount ? ` (${p.commitCount} commit${p.commitCount === 1 ? "" : "s"})` : ""}`,
      );
    lines.push(`Commit authors: ${parts.join(", ")}`);
  }
  const reviewers = people.filter((p) => p.roles.includes("reviewer"));
  if (reviewers.length) {
    const parts = reviewers.map(
      (p) =>
        `@${p.login}${p.reviewState ? ` (${REVIEW_STATE_LABEL[p.reviewState] || p.reviewState.toLowerCase()})` : ""}`,
    );
    lines.push(`Reviewers: ${parts.join(", ")}`);
  }
  const commentersOnly = people.filter(
    (p) =>
      p.roles.includes("commenter") && !p.roles.includes("author") && !p.roles.includes("reviewer"),
  );
  if (commentersOnly.length)
    lines.push(`Commenters: ${commentersOnly.map((p) => `@${p.login}`).join(", ")}`);
  if (reviewDecision) lines.push(`Review decision: ${reviewDecision}`);
  if (mergedByLogin) lines.push(`Merged by: @${mergedByLogin}`);
  lines.push(`Avatars: assets/<login>.png (${people.length} contributor(s) — see people.json)`);
  if (botsFiltered.size) lines.push(`(bots filtered out: ${[...botsFiltered].join(", ")})`);
  lines.push("");
}

lines.push("## What the PR says");
lines.push(body || "(no description provided)");
lines.push("");

if (commitLines.length) {
  lines.push(`## Commits (${commitLines.length})`);
  for (const c of commitLines.slice(0, MAX_COMMITS)) lines.push(`- ${c}`);
  if (commitLines.length > MAX_COMMITS)
    lines.push(`- …(+${commitLines.length - MAX_COMMITS} more)`);
  lines.push("");
}

if (files.length) {
  lines.push(`## Files changed (${files.length})`);
  const sortedFiles = [...files].sort(
    (a, b) => b.additions + b.deletions - (a.additions + a.deletions),
  );
  for (const f of sortedFiles.slice(0, MAX_FILES_LISTED)) {
    lines.push(`- ${f.path}  (+${f.additions} / -${f.deletions})`);
  }
  if (files.length > MAX_FILES_LISTED)
    lines.push(`- …(+${files.length - MAX_FILES_LISTED} more files)`);
  lines.push("");
}

if (diffSections.length) {
  lines.push("## Representative diff");
  lines.push("");
  lines.push(diffSections.join("\n\n"));
  if (filesOmitted > 0) {
    lines.push("");
    lines.push(
      `…(diff truncated to fit; ${filesOmitted} more changed file(s) omitted — see capture/diff.patch for the full change)`,
    );
  }
  lines.push("");
} else if (diffRaw) {
  lines.push("## Representative diff");
  lines.push("(diff present but no parseable hunks — see capture/diff.patch)");
  lines.push("");
}

const visibleText =
  lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim() + "\n";

// ---------- assemble tokens.json (FE scaffold shape; colors:[] → preset native palette) ----------
const oneLiner = (() => {
  const firstPara = body.split("\n").find((l) => l.trim().length > 0) || title;
  const s = `PR #${number}${repo ? ` in ${repo}` : ""}: ${firstPara}`.replace(/\s+/g, " ").trim();
  return s.length > 150 ? s.slice(0, 147).replace(/\s+\S*$/, "") + "…" : s;
})();
const tokens = {
  title,
  description: oneLiner,
  colors: [],
  fonts: [],
};

// ---------- assemble people.json ----------
const peopleDoc = {
  authorLogin,
  reviewDecision,
  mergedBy: mergedByLogin,
  botsFiltered: [...botsFiltered],
  people, // deduped, bot-filtered; each has roles[] + avatarUrl + avatarFile + avatarFetched
};

// ---------- write ----------
mkdirSync(outDir, { recursive: true });
const tokensOut = join(outDir, "tokens.json");
const textOut = join(outDir, "visible-text.txt");
const peopleOut = join(outDir, "people.json");
writeFileSync(tokensOut, JSON.stringify(tokens, null, 2) + "\n");
writeFileSync(textOut, visibleText);
writeFileSync(peopleOut, JSON.stringify(peopleDoc, null, 2) + "\n");

// ---------- summary ----------
const reviewerCount = people.filter((p) => p.roles.includes("reviewer")).length;
const committerCount = people.filter((p) => p.roles.includes("committer")).length;
console.log(
  [
    `✓ ingest: ${repo || "(repo?)"} PR #${number} — "${title}"`,
    `  +${additions} / -${deletions} across ${changedFiles} file(s); ${commitLines.length} commit(s)`,
    `  diff: ${filesShown} file(s) shown, ${filesOmitted} omitted (budget ${MAX_DIFF_CHARS} chars)`,
    `  people: ${people.length} contributor(s) (${committerCount} commit author(s), ${reviewerCount} reviewer(s)${reviewDecision ? `, decision ${reviewDecision}` : ""}${botsFiltered.size ? `; ${botsFiltered.size} bot(s) filtered` : ""})`,
    `  wrote ${textOut} (${visibleText.length} chars) + ${tokensOut} + ${peopleOut}`,
  ].join("\n"),
);
