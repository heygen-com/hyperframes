#!/usr/bin/env node
// Step 1 — contributor avatar fetch (NETWORK; orchestrator-invoked).
//
// The counterpart to ingest.mjs: ingest is a pure offline transform, THIS is the
// one network step on the people front. It reads the people list ingest produced
// and downloads each contributor's GitHub avatar into assets/<login>.png,
// then rewrites people.json with `avatarFetched` flags so downstream (story-design)
// knows which avatars actually exist.
//
// Avatars + a credits/shipped-by scene are the ONE place the faceless default is
// relaxed. They are an OPTIONAL enhancement, so this script is best-effort:
//   - a missing/deleted user, a network blip, an offline run → log + skip
//   - it ALWAYS exits 0 (a failed avatar must never block the build)
//
// Reads:
//   --people <path>      capture/extracted/people.json (from ingest.mjs)
// Writes:
//   assets/<login>.png    one per contributor whose avatar resolved
//   (rewrites people.json in place with avatarFetched: true/false)
//
// Flags: --project-dir .  --timeout 8000 (ms per request)
//   Avatars are written to <project-dir>/<person.avatarFile>, where avatarFile is
//   the project-root-relative "assets/<login>.png" — the SAME assets/ dir the frame
//   workers reference and assemble-index stages (lib/assets.mjs). Anchor on the
//   project root so the path stays under the project's assets/.
//
// Usage (orchestrator already cd'd into PROJECT_DIR, so --project-dir defaults to "."):
//   node fetch-people-avatars.mjs --people ./capture/extracted/people.json

import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { resolve, join, dirname } from "node:path";

const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
};

const peoplePath = resolve(flag("people", "./capture/extracted/people.json"));
const projectDir = resolve(flag("project-dir", "."));
const TIMEOUT = parseInt(flag("timeout", "8000"), 10);

// Soft-exit helper — avatars are optional, so every early-out is exit 0.
function softExit(msg) {
  console.log(`• fetch-avatars: ${msg}`);
  process.exit(0);
}

if (!existsSync(peoplePath)) softExit(`no people.json at ${peoplePath} — skipping (no avatars)`);

let doc;
try {
  doc = JSON.parse(readFileSync(peoplePath, "utf8"));
} catch (e) {
  softExit(`people.json unreadable (${e.message}) — skipping`);
}

const people = Array.isArray(doc.people) ? doc.people : [];
if (!people.length) softExit("no contributors in people.json — skipping");

async function fetchOne(person) {
  const { login, avatarUrl } = person;
  if (!login || !avatarUrl) return "skip";
  // avatarFile is project-root-relative ("assets/<login>.png"); anchor on the
  // project root so it stays under the project's assets/ dir.
  const dest = join(projectDir, person.avatarFile || `assets/${login}.png`);
  mkdirSync(dirname(dest), { recursive: true });
  // Idempotent: a non-empty file from a prior run is reused (re-runs are free).
  if (existsSync(dest) && statSync(dest).size > 0) {
    person.avatarFetched = true;
    return "cached";
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(avatarUrl, {
      signal: ctrl.signal,
      redirect: "follow", // github.com/<login>.png redirects to avatars.githubusercontent.com
      headers: { "User-Agent": "hyperframes-pr-to-video" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) throw new Error("empty body");
    writeFileSync(dest, buf);
    person.avatarFetched = true;
    return "ok";
  } catch (e) {
    person.avatarFetched = false;
    console.log(`  (skip avatar @${login}: ${e.message})`);
    return "fail";
  } finally {
    clearTimeout(timer);
  }
}

let ok = 0;
let cached = 0;
let fail = 0;
// Sequential keeps it simple and gentle on github.com; the list is tiny (a PR's
// contributors), so latency is not a concern.
for (const person of people) {
  const r = await fetchOne(person);
  if (r === "ok") ok++;
  else if (r === "cached") cached++;
  else if (r === "fail") fail++;
}

// Persist avatarFetched flags so story-design can reference only real avatars.
try {
  writeFileSync(peoplePath, JSON.stringify(doc, null, 2) + "\n");
} catch (e) {
  console.log(`  (warn: could not rewrite people.json flags: ${e.message})`);
}

console.log(
  `✓ fetch-avatars: ${ok + cached}/${people.length} avatar(s) in assets/` +
    ` (${ok} new, ${cached} cached, ${fail} failed)`,
);
process.exit(0);
