#!/usr/bin/env node
// transitions.mjs — inter-frame transition injector + verifier for the video workflow.
//
//   inject  — read STORYBOARD frame order + each frame's transition_in, overlap
//             the frame clip wrappers in index.html, and stamp the GSAP template.
//   verify  — deterministic gate over the injector's output.
//
// transition_in (written by story-design on the INCOMING frame) names a registry
// type directly: crossfade | blur-crossfade | push-slide | zoom-through | squeeze,
// optionally "<type> <DIR>" / "<type> <N>s" (e.g. "push-slide LEFT", "crossfade
// 0.4s"). `cut` / `none` / empty ⇒ hard cut (no overlap, no stamp).
//
// Mechanics — EXTEND-OUTGOING-ONLY (keeps voice/SFX/captions synced; their timing
// is keyed to the original frame start). At boundary i→i+1 (type = the incoming
// frame's transition_in): extend ONLY the outgoing wrapper's data-duration by
// `dur` so it holds its final frame across the window; do NOT move any data-start;
// the incoming — already present from the cut on a higher track — fades/pushes in
// over it. Then 0/1-ping-pong ALL frame clips' data-track-index (adjacent
// overlapping wrappers never share a track — lint timeline_track_too_dense) and
// stamp the token-substituted GSAP template into __timelines["main"] at T =
// incoming start. captions(2)/voice(10)/bgm(11)/sfx(20+) are never touched.
//
//   node transitions.mjs inject --storyboard ./STORYBOARD.md --hyperframes .
//   node transitions.mjs verify --storyboard ./STORYBOARD.md --index ./index.html

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseStoryboard } from "./lib/storyboard.mjs";
import { parseFormat } from "./lib/dimensions.mjs";
import { loadTransitionRegistry, transitionsByName } from "./lib/transition-registry.mjs";

const flag = (argv, name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
};
const NO_TRANSITION = new Set(["cut", "none", ""]);
const r3 = (x) => Number(x.toFixed(3));

// transition_in → { type, direction?, dur? } | null (hard cut).
function parseTransitionIn(raw) {
  const s = (raw ?? "").trim();
  if (NO_TRANSITION.has(s.toLowerCase())) return null;
  const parts = s.split(/\s+/);
  const spec = { type: parts[0].toLowerCase() };
  for (const p of parts.slice(1)) {
    const m = p.match(/^(\d+(?:\.\d+)?)s?$/);
    if (m) spec.dur = Number(m[1]);
    else spec.direction = p.toUpperCase();
  }
  return spec;
}

// Mounted STORYBOARD frames present in index.html, in document order: { id, frame }.
function mountedFramesInOrder(manifest, html) {
  const out = [];
  for (const f of manifest.frames) {
    if (!f.src) continue;
    const id = f.src
      .split("/")
      .pop()
      .replace(/\.html?$/i, "");
    if (html.includes(`id="el-${id}"`)) out.push({ id, frame: f });
  }
  return out;
}

// Frame clip wrappers parsed out of index.html (ids carry hyphens; excludes
// el-captions and audio by keying off the known frame-id set). The id is matched
// from anywhere in the tag's attribute list — never assume it is the first attribute
// (the index assembler emits data-hf-id before id, so an id-first regex finds nothing
// and inject crashes on the empty clip map).
function parseFrameClips(html, frameIds) {
  const clipRe = /<div\b([^>]*)><\/div>/g;
  const clips = new Map();
  let m;
  while ((m = clipRe.exec(html)) !== null) {
    const attrs = m[1];
    const idm = attrs.match(/\bid="el-([A-Za-z0-9_-]+)"/);
    if (!idm || !frameIds.has(idm[1])) continue;
    const num = (re) => {
      const x = attrs.match(re);
      return x ? Number(x[1]) : null;
    };
    clips.set(idm[1], {
      id: idm[1],
      block: m[0],
      start: num(/data-start="([\d.]+)"/),
      duration: num(/data-duration="([\d.]+)"/),
      track: num(/data-track-index="(\d+)"/) ?? 0,
    });
  }
  return clips;
}

// Resolve a transition_in spec to a registry record (calm default on unknown).
function resolveRecord(spec, byName, reg, warn) {
  let rec = byName.get(spec.type);
  if (!rec) {
    rec = byName.get(reg.default_calm);
    warn(`transition_in "${spec.type}" not in registry — using ${reg.default_calm}`);
  }
  return rec;
}
function resolveDur(spec, rec, reg) {
  let dur = spec.dur ?? rec.default_duration_s ?? 0.5;
  return Math.min(dur, reg.max_duration_s ?? 2.0);
}

// GSAP lines for one transition record (token substitution).
function buildGsap(rec, fromId, toId, dur, T, direction, canvasW, canvasH, die) {
  const subs = {
    __OLD__: `"#el-${fromId}"`,
    __NEW__: `"#el-${toId}"`,
    __T__: String(T),
    __DUR__: String(dur),
  };
  let template;
  if (rec.directions && rec.directions.length > 0) {
    const dir = (direction || rec.default_direction || rec.directions[0]).toUpperCase();
    const vertical = dir === "UP" || dir === "DOWN";
    template = vertical ? rec.gsap_template_vertical : rec.gsap_template_horizontal;
    if (!template)
      die(`transition ${rec.name}: missing ${vertical ? "vertical" : "horizontal"} template`);
    if (vertical) {
      const dy = dir === "UP" ? -canvasH : canvasH;
      subs.__DY__ = String(dy);
      subs.__DYIN__ = String(-dy);
    } else {
      const dx = dir === "LEFT" ? -canvasW : canvasW;
      subs.__DX__ = String(dx);
      subs.__DXIN__ = String(-dx);
    }
  } else {
    template = rec.gsap_template;
    if (!template) die(`transition ${rec.name}: missing gsap_template`);
  }
  return template.map((line) => {
    let out = line;
    for (const [k, v] of Object.entries(subs)) out = out.split(k).join(v);
    return out;
  });
}

function runInject(argv) {
  const hyperframesDir = resolve(flag(argv, "hyperframes", "."));
  const storyboardPath = resolve(flag(argv, "storyboard", join(hyperframesDir, "STORYBOARD.md")));
  const indexPath = join(hyperframesDir, "index.html");
  const die = (msg) => {
    console.error(`✗ transitions inject: ${msg}`);
    process.exit(1);
  };

  if (!existsSync(storyboardPath)) die(`STORYBOARD.md not found at ${storyboardPath}`);

  const manifest = parseStoryboard(readFileSync(storyboardPath, "utf8"));
  const { width: CW, height: CH } = parseFormat(manifest.globals.format);
  const reg = loadTransitionRegistry();
  const byName = transitionsByName();

  // Read directly and handle ENOENT here, rather than an existsSync precheck —
  // the check→write pair (write-back below) is a TOCTOU race CodeQL flags.
  let html = "";
  try {
    html = readFileSync(indexPath, "utf8");
  } catch {
    die(`index.html not found at ${indexPath} — run assemble-index.mjs first`);
  }
  const order = mountedFramesInOrder(manifest, html);
  if (order.length === 0) die("no frame clips found in index.html");
  const frameIds = new Set(order.map((x) => x.id));
  const clips = parseFrameClips(html, frameIds);

  const gsapLines = [];
  const applied = [];
  for (let i = 1; i < order.length; i++) {
    const spec = parseTransitionIn(order[i].frame.transitionIn);
    if (!spec) continue; // hard cut
    const incoming = clips.get(order[i].id);
    const outgoing = clips.get(order[i - 1].id);
    const rec = resolveRecord(spec, byName, reg, (m) =>
      console.error(`  ! frame ${order[i].id}: ${m}`),
    );
    const dur = resolveDur(spec, rec, reg);
    const T = r3(incoming.start); // cut = incoming start (frames tile)
    outgoing.duration = r3(outgoing.duration + dur); // extend outgoing only
    gsapLines.push(
      ...buildGsap(rec, outgoing.id, incoming.id, dur, T, spec.direction, CW, CH, die),
    );
    applied.push({ from: outgoing.id, to: incoming.id, type: rec.name, dur, T });
  }

  if (applied.length === 0) {
    console.log(`✓ transitions inject: 0 transitions (all cuts) — index.html unchanged`);
    return;
  }

  // 0/1 ping-pong all frame clips in play order.
  const ordered = [...clips.values()].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  ordered.forEach((c, i) => {
    c.track = i % 2;
  });

  // rewrite each clip block: start unchanged; duration possibly extended; track ping-ponged.
  for (const c of clips.values()) {
    const nb = c.block
      .replace(/data-duration="[\d.]+"/, `data-duration="${c.duration}"`)
      .replace(/data-track-index="\d+"/, `data-track-index="${c.track}"`);
    html = html.replace(c.block, nb);
  }

  // stamp the GSAP after the master timeline anchor.
  const anchor = 'window.__timelines["main"] = gsap.timeline({ paused: true });';
  if (!html.includes(anchor)) die("master timeline anchor not found in index.html");
  // The transition tweens alone leave window.__timelines["main"] spanning only the
  // last transition (e.g. 24.7s), shorter than the real composition. The Studio
  // reads main.duration() as its master duration and parses clips against it, so a
  // short master collapses its timeline (clips dropped, duration wrong, blank stage)
  // — the render engine is unaffected (it trusts the root data-duration attr). Stamp
  // a full-span anchor so main.duration() == composition total. Mirrors the
  // `tl.to({}, { duration })` anchor captions.html already uses.
  const rootDurMatch = html.match(/data-composition-id="main"[^>]*?data-duration="([\d.]+)"/);
  const totalDur = rootDurMatch ? Number(rootDurMatch[1]) : null;
  const block = [
    anchor,
    "      // ── frame transitions (injected by transitions.mjs) ──",
    '      (function () { var tl = window.__timelines["main"];',
    ...gsapLines.map((l) => "        " + l),
    ...(totalDur
      ? [
          `        tl.to({}, { duration: ${totalDur} }, 0); // full-span anchor — main.duration() == composition total (Studio master duration)`,
        ]
      : []),
    "      })();",
  ].join("\n");
  html = html.replace(anchor, block);

  writeFileSync(indexPath, html);
  console.log(`✓ transitions inject: ${applied.length} transition(s) stamped into index.html`);
  for (const a of applied) console.log(`  ${a.from}→${a.to}: ${a.type} ${a.dur}s @ T=${a.T}s`);
  const tracks = ordered
    .map((c) => `${c.id}[t${c.track} ${c.start}→${r3(c.start + c.duration)}]`)
    .join(" ");
  console.log(`  tracks: ${tracks}`);
}

function runVerify(argv) {
  const hyperframesDir = resolve(flag(argv, "hyperframes", "."));
  const storyboardPath = resolve(flag(argv, "storyboard", join(hyperframesDir, "STORYBOARD.md")));
  const indexPath = resolve(flag(argv, "index", join(hyperframesDir, "index.html")));
  const bail = (msg) => {
    console.error(`✗ transitions verify: ${msg}`);
    process.exit(1);
  };

  if (!existsSync(storyboardPath)) bail("STORYBOARD.md not found");
  if (!existsSync(indexPath)) bail("index.html not found");

  const manifest = parseStoryboard(readFileSync(storyboardPath, "utf8"));
  const html = readFileSync(indexPath, "utf8");
  const order = mountedFramesInOrder(manifest, html);
  const frameIds = new Set(order.map((x) => x.id));
  const clips = parseFrameClips(html, frameIds);

  const EPS = 0.011;
  const overlaps = (a, b) =>
    a.start < b.start + b.duration - EPS && b.start < a.start + a.duration - EPS;
  const fail = [];

  // (4) global no same-track overlap (the lint invariant).
  const all = [...clips.values()];
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i];
      const b = all[j];
      if (a.track === b.track && overlaps(a, b))
        fail.push(`same-track overlap: ${a.id}[t${a.track}] & ${b.id}[t${b.track}]`);
    }

  const bm = html.match(/frame transitions \(injected[\s\S]*?\}\)\(\);/);
  const txBlock = bm ? bm[0] : "";

  let expected = 0;
  for (let i = 1; i < order.length; i++) {
    const spec = parseTransitionIn(order[i].frame.transitionIn);
    if (!spec) continue;
    expected++;
    const to = clips.get(order[i].id);
    const from = clips.get(order[i - 1].id);
    if (!to || !from) {
      fail.push(`boundary ${order[i - 1].id}→${order[i].id}: wrapper missing`);
      continue;
    }
    if (!txBlock.includes(`"#el-${from.id}"`) || !txBlock.includes(`"#el-${to.id}"`))
      fail.push(`boundary ${from.id}→${to.id}: injected block does not reference both ids`);
    const overlapAmt = r3(from.start + from.duration - to.start);
    if (overlapAmt <= 0) fail.push(`boundary ${from.id}→${to.id}: no overlap (${overlapAmt}s)`);
    if (from.track === to.track)
      fail.push(`boundary ${from.id}→${to.id}: both on track ${from.track}`);
  }
  if (expected > 0 && !txBlock)
    fail.push(`${expected} transition(s) expected but no injected block found`);

  if (fail.length) {
    console.error(`✗ transitions verify: ${fail.length} failure(s):`);
    for (const f of fail) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(
    `✓ transitions verify: ${expected} transition(s) verified (cross-track, overlap>0, both ids referenced, no same-track overlap)`,
  );
}

const sub = process.argv[2];
const rest = process.argv.slice(3);
if (sub === "inject") runInject(rest);
else if (sub === "verify") runVerify(rest);
else {
  console.error("usage: node transitions.mjs <inject|verify> [args...]");
  process.exit(2);
}
