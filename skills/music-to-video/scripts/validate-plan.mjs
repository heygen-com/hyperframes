#!/usr/bin/env node
// validate-plan.mjs — machine-check STORYBOARD.md against the audiomap + template
// catalog at Step 3, before any frame is built. Runs on the PLAN (frame files do
// not exist yet), so it checks fields, not on-disk html.
//
// HARD (exit 1): frontmatter duration_s == audiomap duration; >=1 frame; each frame
//   has src + positive duration; frames tile the track gap-free (sum == duration_s);
//   every frame has >=1 filled group (a frame whose `### Groups` is still
//   `TBD (Step 3)`/empty is a Step-2 skeleton, not an approved plan — fail it so a
//   skipped Step 3 can never reach the build step).
// WARN (exit 0): best-effort group checks — each group exactly one of
//   template/free_design/asset; a template id exists under the --templates dir;
//   phrase_flow frame has no beat_cut asset treatment.
//
// Frame-level checks use the vendored storyboard parser. Group-level checks re-scan
// the RAW source (the parser's META_RE consumes indented `- params:`/`- asset:` lines).
//
// Reads: --storyboard, --audiomap, --hyperframes <root> (for templates/).

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseStoryboard } from "./lib/storyboard.mjs";

const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d;
};
const hyperframesDir = resolve(flag("hyperframes", "."));
const storyboardPath = resolve(flag("storyboard", join(hyperframesDir, "STORYBOARD.md")));
const audiomapPath = resolve(flag("audiomap", join(hyperframesDir, "audiomap.json")));
const templatesDir = resolve(flag("templates", join(hyperframesDir, "templates")));

const errors = [];
const warns = [];
const r3 = (x) => Math.round(x * 1000) / 1000;

if (!existsSync(storyboardPath)) {
  console.error(`✗ STORYBOARD.md not found at ${storyboardPath}`);
  process.exit(1);
}
const raw = readFileSync(storyboardPath, "utf8");
const manifest = parseStoryboard(raw);
const G = manifest.globals.extra ?? {};

// ---------- audio duration ----------
let audioDur = null;
if (existsSync(audiomapPath)) {
  try {
    audioDur = JSON.parse(readFileSync(audiomapPath, "utf8"))?.audio?.duration_sec ?? null;
  } catch (e) {
    warns.push(`audiomap parse failed: ${e.message}`);
  }
} else {
  warns.push(`audiomap not found at ${audiomapPath} — skipping duration cross-check`);
}

// ---------- frontmatter duration_s ----------
const declaredDur = G.duration_s != null ? Number.parseFloat(G.duration_s) : NaN;
if (!Number.isFinite(declaredDur)) errors.push(`frontmatter \`duration_s\` missing or unparseable`);
else if (audioDur != null && Math.abs(declaredDur - audioDur) > 0.05)
  errors.push(`frontmatter duration_s (${declaredDur}) != audiomap duration (${audioDur})`);

// ---------- frames (hard) ----------
const frames = manifest.frames;
if (frames.length === 0) errors.push(`no frames (no \`## Frame N — <id>\` headings found)`);

let sum = 0;
for (const f of frames) {
  const label = `frame ${f.number ?? f.index}${f.title ? ` (${f.title})` : ""}`;
  if (!f.src) errors.push(`${label}: missing \`- src:\``);
  if (!Number.isFinite(f.durationSeconds) || f.durationSeconds <= 0)
    errors.push(`${label}: missing/!positive \`- duration:\` (got ${JSON.stringify(f.duration)})`);
  else sum += f.durationSeconds;
}
sum = r3(sum);
const tileTarget = Number.isFinite(declaredDur) ? declaredDur : audioDur;
if (tileTarget != null && Math.abs(sum - tileTarget) > 0.1)
  errors.push(
    `frame durations sum to ${sum}s but the track is ${tileTarget}s — frames must tile it gap-free`,
  );

// ---------- group checks (warns) — parse RAW text ----------
const FRAME_HEAD = /^##\s+(?:frame|scene|section)\b/i;
const GROUP_HEAD = /^\s*[-*]\s*\*\*\s*(\w+)\s*\*\*\s*[—:-]\s*(template|free_design|asset)\b(.*)$/i;
const templateExistsCache = new Map();
function templateExists(id) {
  if (templateExistsCache.has(id)) return templateExistsCache.get(id);
  const ok = existsSync(join(templatesDir, id, "index.html"));
  templateExistsCache.set(id, ok);
  return ok;
}

// walk raw lines → group blocks tagged with their frame label + pacing
const blocks = [];
let frameLabel = "?";
let pacing = "";
let cur = null;
for (const ln of raw.split(/\r?\n/)) {
  if (FRAME_HEAD.test(ln)) {
    frameLabel = ln.replace(/^#+\s+/, "").trim();
    pacing = "";
    cur = null;
    continue;
  }
  const pm = ln.match(/^\s*[-*]\s*pacing\s*:\s*([A-Za-z_]+)/i);
  if (pm && !cur) {
    pacing = pm[1].toLowerCase();
    continue;
  }
  const h = GROUP_HEAD.exec(ln);
  if (h) {
    cur = { frameLabel, pacing, name: h[1], kind: h[2].toLowerCase(), rest: h[3] ?? "", lines: [] };
    blocks.push(cur);
    continue;
  }
  if (cur) cur.lines.push(ln);
}

// HARD: every frame needs >=1 filled group. A frame with no parseable group head
// is still a Step-2 skeleton (`### Groups` = `TBD (Step 3)`/empty) — erroring here
// is what stops a skipped Step 3 from reaching the build step.
const framesWithGroups = new Set(blocks.map((b) => b.frameLabel));
for (const f of frames) {
  const title = String(f.title ?? "").trim();
  const lbl = `Frame ${f.number ?? ""} — ${f.title ?? f.index}`.replace(/\s+—\s+$/, "");
  const hasGroup = title !== "" && [...framesWithGroups].some((s) => s.includes(title));
  if (!hasGroup) {
    errors.push(
      `${lbl}: no filled groups — still a Step-2 skeleton (\`### Groups\` is TBD/empty). ` +
        `Run Step 3: fill its groups (\`- **gN** — template|free_design|asset …\`) before building.`,
    );
  }
}

for (const b of blocks) {
  const gid = `${b.frameLabel} / ${b.name}`;
  const blockText = b.rest + " " + b.lines.join(" ");
  if (b.kind === "template") {
    const m = b.rest.match(/`([^`]+)`/) || b.rest.match(/:\s*([\w-]+)/);
    const id = m ? m[1].trim() : null;
    if (!id) warns.push(`${gid}: template kind but no template id on the head line`);
    else if (!templateExists(id))
      warns.push(`${gid}: template \`${id}\` not found at templates/${id}/index.html`);
  }
  if (b.kind === "asset" && b.pacing === "phrase_flow" && /beat_cut/.test(blockText))
    warns.push(
      `${gid}: beat_cut asset treatment on a phrase_flow frame — use ken_burns/crossfade instead`,
    );
}

// ---------- report ----------
for (const w of warns) console.log(`⚠ ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`✗ ${e}`);
  console.error(`\nvalidate-plan: ${errors.length} error(s), ${warns.length} warning(s)`);
  process.exit(1);
}
console.log(
  `✓ validate-plan: ${frames.length} frames tile ${sum}s; ${blocks.length} groups; ${warns.length} warning(s)`,
);
