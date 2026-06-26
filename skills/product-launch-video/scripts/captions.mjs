#!/usr/bin/env node
// captions.mjs — build the captions sub-composition from STORYBOARD + audio_meta.
//
// One mode: `build`. Reads STORYBOARD.md (frame order + durations → cumulative
// frame starts) + audio_meta.json (voices[].words, frame-relative) → absolute-
// timed caption groups → writes:
//   compositions/captions.html  — a self-contained sub-composition the index
//        assembler mounts on its captions track (data-composition-id="captions").
//   caption_groups.json         — the computed groups (debug / inspection / --out).
//   caption-overrides.json      — an empty `[]` shim (silences the captions runtime's
//        validate-time fetch; only written when captions.html is).
// No narration / no words → legal skip: nothing written, assemble-index then omits
// the captions track (it keys off compositions/captions.html existence).
//
//   node captions.mjs build --storyboard ./STORYBOARD.md --audio-meta ./audio_meta.json --hyperframes . --out ./caption_groups.json
//
// CAPTION LOOK — two sources, picked automatically:
//   1. PRESET SKIN (preferred). If a project-local `.hyperframes/caption-skin.html`
//      exists (Step 2 copies the chosen frame-preset's skin into the project), it is
//      the caption look.
//      It is a brand-token-strict skin with three reserved holes; this script fills them
//      and wraps the result in a <template> for the engine:
//        - `var GROUPS = [];`            → the computed caption groups
//        - `var DURATION = 0;` + data-duration="0" (and data-width/height="0") → real values
//        - `<style data-brand-tokens></style>` → :root tokens derived from the project's
//          frame.md (colors + fonts), mapped to a fixed semantic vocab every skin shares:
//          --cap-ink / --cap-canvas / --cap-accent / --cap-accent-2 / --font-display /
//          --font-body, plus --cap-band-top / --cap-band-height (the keep-out band).
//      So the brand-token overlay from Step 2 flows into the captions automatically.
//   2. DEFAULT (fallback). No skin file → the built-in Roboto/black pill (buildCaptionsHtml).
//
// Grouping mirrors the proven heuristics (frame boundary · sentence-end punct ·
// silence gap · density-aware word cap); word timings come inline from audio_meta.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseStoryboard } from "./lib/storyboard.mjs";
import { captionBand, parseFormat } from "./lib/dimensions.mjs";
import { parseColors, parseFonts, semanticColors, lum } from "./lib/tokens.mjs";

const flag = (argv, name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
};
const r3 = (x) => Number(x.toFixed(3));

// ── grouping params ───────────────────────────────────────────────────────────
const SILENCE_GAP = 0.18; // s of silence between words → split
const TAIL_PAD = 0.12; // s the group lingers after its last word
const SENT_END = /[.?!,;:—]$/;
const DENSITY_WINDOW = 1.0; // s window for words/sec density
function wordCap(density) {
  return density > 3.5 ? 2 : density > 2.5 ? 3 : 4;
}

function runBuild(argv) {
  const skip = (reason) => {
    console.log(`captions: skipped (${reason})`);
    process.exit(0);
  };
  const die = (m) => {
    console.error(`✗ captions build: ${m}`);
    process.exit(1);
  };

  const hyperframesDir = resolve(flag(argv, "hyperframes", "."));
  const storyboardPath = resolve(flag(argv, "storyboard", join(hyperframesDir, "STORYBOARD.md")));
  const audioMetaPath = resolve(flag(argv, "audio-meta", join(hyperframesDir, "audio_meta.json")));
  const outPath = resolve(flag(argv, "out", join(hyperframesDir, "caption_groups.json")));
  const htmlPath = join(hyperframesDir, "compositions/captions.html");
  const overridesPath = join(hyperframesDir, "caption-overrides.json");
  const skinArg = flag(argv, "skin", null);
  const hiddenSkinPath = join(hyperframesDir, ".hyperframes", "caption-skin.html");
  const legacySkinPath = join(hyperframesDir, "caption-skin.html");
  const skinPath = resolve(
    skinArg ?? (existsSync(hiddenSkinPath) ? hiddenSkinPath : legacySkinPath),
  );
  const framePath = resolve(flag(argv, "frame", join(hyperframesDir, "frame.md")));

  if (!existsSync(storyboardPath)) die(`STORYBOARD.md not found at ${storyboardPath}`);
  const manifest = parseStoryboard(readFileSync(storyboardPath, "utf8"));
  const { width: W, height: H } = parseFormat(manifest.globals.format);

  if (!existsSync(audioMetaPath)) skip("no audio_meta.json (silent film)");
  const meta = JSON.parse(readFileSync(audioMetaPath, "utf8"));
  if (!Array.isArray(meta.voices) || meta.voices.length === 0) skip("no narration");

  // cumulative frame starts (by frame number) + total duration, from STORYBOARD.
  const startByFrame = new Map();
  let acc = 0;
  for (const f of manifest.frames) {
    if (f.number != null) startByFrame.set(f.number, acc);
    acc += Number.isFinite(f.durationSeconds) ? f.durationSeconds : 0;
  }
  const total = r3(acc);

  // absolute word stream: frame start + frame-relative word timing.
  const words = [];
  for (const v of meta.voices) {
    const base = startByFrame.get(v.frame);
    if (base == null || !Array.isArray(v.words)) continue;
    for (const w of v.words) {
      const text = String(w.text ?? "").trim();
      if (!text || /^[.?!,;:—–-]+$/.test(text)) continue; // drop empties + bare punctuation
      if (!isFinite(w.start) || !isFinite(w.end)) continue;
      words.push({ text, start: r3(base + w.start), end: r3(base + w.end), frame: v.frame });
    }
  }
  words.sort((a, b) => a.start - b.start);
  if (words.length === 0) skip("no usable words");

  // density at i = words whose start falls within [w.start, w.start + WINDOW).
  const densityAt = (i) => {
    const t0 = words[i].start;
    let n = 0;
    for (let j = i; j < words.length && words[j].start < t0 + DENSITY_WINDOW; j++) n++;
    return n / DENSITY_WINDOW;
  };

  // group: split on frame change / silence gap / word cap; always flush after a
  // sentence-ending word.
  const groups = [];
  let cur = null;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = cur && cur.words[cur.words.length - 1];
    const crossFrame = cur && w.frame !== cur.frame;
    const gap = prev && w.start - prev.end > SILENCE_GAP;
    const full = cur && cur.words.length >= cur.cap;
    if (!cur || crossFrame || gap || full) {
      if (cur) groups.push(cur);
      cur = { frame: w.frame, cap: wordCap(densityAt(i)), words: [] };
    }
    cur.words.push(w);
    if (SENT_END.test(w.text)) {
      groups.push(cur);
      cur = null;
    }
  }
  if (cur) groups.push(cur);

  // finalize: ids, start/end (tail-padded, clamped < next group's start), text.
  const finalized = groups.map((g, gi) => {
    const first = g.words[0];
    const last = g.words[g.words.length - 1];
    const next = groups[gi + 1];
    let end = r3(last.end + TAIL_PAD);
    if (next && next.words[0].start < end) end = r3(next.words[0].start);
    return {
      id: `caption-group-${gi}`,
      frame: g.frame,
      start: r3(first.start),
      end,
      text: g.words.map((w) => w.text).join(" "),
      words: g.words.map((w, wi) => ({
        id: `caption-word-${gi}-${wi}`,
        text: w.text,
        start: r3(w.start),
        end: r3(w.end),
      })),
    };
  });

  // ── write caption_groups.json ──
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(
    outPath,
    JSON.stringify({ total_duration_s: total, width: W, height: H, groups: finalized }, null, 2),
  );

  // ── write compositions/captions.html (preset skin if present, else default) ──
  mkdirSync(dirname(htmlPath), { recursive: true });
  let source;
  if (existsSync(skinPath)) {
    const tokens = frameTokensCss(framePath, H);
    const faces = brandFontFaces(framePath, hyperframesDir);
    const fonts = existsSync(framePath) ? parseFonts(readFileSync(framePath, "utf8")) : {};
    writeFileSync(
      htmlPath,
      buildFromSkin(
        readFileSync(skinPath, "utf8"),
        finalized,
        total,
        W,
        H,
        tokens,
        die,
        faces,
        fonts,
      ),
    );
    source = `preset skin (${skinPath.replace(hyperframesDir + "/", "")})`;
  } else {
    writeFileSync(htmlPath, buildCaptionsHtml(finalized, total, W, H));
    source = "default (built-in pill)";
  }

  // ── write caption-overrides.json shim ──
  // Atomic create-if-absent: `wx` throws if the file already exists (which we
  // ignore) — no existsSync→writeFileSync TOCTOU gap.
  try {
    writeFileSync(overridesPath, "[]\n", { flag: "wx" });
  } catch {
    /* overrides shim already present */
  }

  console.log(
    `✓ captions build: ${finalized.length} group(s) from ${words.length} words → compositions/captions.html (total ${total}s) · skin: ${source}`,
  );
}

// ── preset-skin path ────────────────────────────────────────────────────────
// Fill the skin's three reserved holes + the root's 0-placeholders, then wrap the
// fragment in a <template> (the engine clones template contents only). One generic
// fill works for every preset's skin — no per-skin transform.
//
// Every preset's skin is authored against ITS OWN fonts/metrics (broadside→Barlow @
// line-height 1.02, capsule→Bodoni, …). When the project's brand font differs (it
// almost always does), three things must be reconciled so ANY skin renders correctly
// for ANY brand — done here generically, not per-project:
//   · @font-face for the brand fonts (else the renderer can't supply them → fallback)
//   · the skin's preset-font FALLBACK literals (var(--font-x, "Barlow")) repointed to
//     the brand family, so no undeclared font name trips font_family_without_font_face
//   · a metric safety net: a heavier brand font overflows a tight preset line-height,
//     so the active-word highlight clips — a line-height floor + word padding fixes it
//   · data-composition-id + dimensions on the <template> root (skins lead with
//     <script>/<style>, so the root element must carry the id, not the first child)
function buildFromSkin(skin, groups, total, W, H, tokens, die, faces = "", fonts = {}) {
  const fillOnce = (src, re, repl, label) => {
    const n = (src.match(re) || []).length;
    if (n !== 1) die(`caption-skin.html: expected exactly one ${label}, found ${n}`);
    return src.replace(re, () => repl);
  };
  let out = skin;
  // Strip HTML doc-comments first. A skin's authoring comment can contain tag-like text
  // (broadside's literally says "<template>"), which the linter's tag scanner then picks
  // up as the root element → false root_missing_composition_id / root_missing_dimensions.
  // The comments are preview/authoring docs, not needed in the generated composition.
  // Strip in a fixpoint loop, not a single global pass: removing one comment can
  // re-form a marker from a nested/partial pair (e.g. <!--<!---->-->), which one
  // pass misses — CodeQL flags the single replace as incomplete sanitization.
  for (let prev = ""; prev !== out; ) {
    prev = out;
    out = out.replace(/<!--[\s\S]*?-->/g, "");
  }
  // brand :root tokens + @font-face for the brand fonts, both into the reserved hole
  out = fillOnce(
    out,
    /<style data-brand-tokens>\s*<\/style>/,
    `<style data-brand-tokens>\n${faces ? faces + "\n" : ""}${tokens}\n    </style>`,
    "<style data-brand-tokens></style> hole",
  );
  // Resolve the skin's font-family var()s to the brand family LITERAL. Two reasons:
  //  (1) the linter's used-font scanner naively comma-splits, so var(--x, "Brand") yields
  //      junk tokens ('var(--x', 'brand")') that never match the @font-face → a false
  //      font_family_without_font_face; a plain "Brand" literal matches the @font-face.
  //  (2) it drops the preset's own fallback name (Barlow / IBM Plex Mono / …), which has
  //      no @font-face in this project. The :root token stays for any other consumer.
  if (fonts.display)
    out = out.replace(/var\(\s*--font-display\s*(?:,\s*"[^"]*"\s*)?\)/g, fonts.display);
  if (fonts.body) out = out.replace(/var\(\s*--font-body\s*(?:,\s*"[^"]*"\s*)?\)/g, fonts.body);
  out = fillOnce(
    out,
    /var GROUPS = \[\];/,
    `var GROUPS = ${JSON.stringify(groups)};`,
    "`var GROUPS = [];` hole",
  );
  out = fillOnce(out, /var DURATION = 0;/, `var DURATION = ${total};`, "`var DURATION = 0;` hole");
  out = fillOnce(out, /data-duration="0"/, `data-duration="${total}"`, '`data-duration="0"` hole');
  out = fillOnce(out, /data-width="0"/, `data-width="${W}"`, '`data-width="0"` hole');
  out = fillOnce(out, /data-height="0"/, `data-height="${H}"`, '`data-height="0"` hole');
  // font-robust safety net — appended last so it wins the cascade over the skin's own
  // (preset-font-tuned) line-height. Kept SNUG (1.1) so the plate hugs the text. NO extra
  // word/pill padding: inspect's `text_box_overflow` on the highlight words is a cosmetic
  // false-positive here (heavy-glyph ink slightly exceeds the line box, but there's no
  // overflow:hidden — nothing is clipped); zeroing it would need an airy line-height that
  // balloons the pill, which is worse. Override only if a brand font genuinely clips.
  out += "\n<style>\n  .caption-line { line-height: 1.1 !important; }\n</style>";
  // dark-ground caption contrast (auto). The preset caption skins are tuned for a LIGHT
  // pill (cream); on a dark brand ground the pill goes near-black, so the skin's faint
  // upcoming-word mix and light highlight block turn unreadable. When the resolved caption
  // canvas is dark, override the three word states: a brighter muted upcoming color + an
  // on-brand ACCENT highlight block with light text. Light grounds are left untouched.
  const capCanvas = (tokens.match(/--cap-canvas:\s*(#[0-9a-fA-F]{6})/) || [])[1];
  if (capCanvas && (lum(capCanvas) ?? 255) < 90) {
    out +=
      "\n<style>\n" +
      "  .caption-word { color: color-mix(in srgb, var(--cap-ink) 64%, var(--cap-canvas)); }\n" +
      "  .caption-word.is-active { color: var(--cap-ink); background: var(--cap-accent); box-shadow: 0 0 0 0.06em var(--cap-accent); }\n" +
      "  .caption-word.is-spoken { color: var(--cap-ink); background: transparent; box-shadow: none; }\n" +
      "</style>";
  }
  return `<template id="captions-template" data-composition-id="captions" data-width="${W}" data-height="${H}">\n${out.trim()}\n</template>\n`;
}

// @font-face for the brand display/body fonts, matched from the project's font dirs
// (staged assets/fonts first, else capture/assets/fonts) by family-name prefix, with
// weight parsed from the filename. Paths are relative to compositions/captions.html.
// Returns "" when frame.md or font files are absent (then the skin's fallback applies).
function brandFontFaces(framePath, hyperframesDir) {
  if (!existsSync(framePath)) return "";
  const { display, body } = parseFonts(readFileSync(framePath, "utf8"));
  const families = [
    ...new Set([display, body].filter(Boolean).map((f) => f.replace(/^"|"$/g, ""))),
  ];
  if (!families.length) return "";
  const dirs = [
    // ROOT-RELATIVE — compositions are served with the project root as their base URL, so a
    // "../" prefix escapes the root (lint: invalid_parent_traversal_in_asset_path) and 404s in
    // Studio/preview. Mirror what the frame workers use for images.
    { abs: join(hyperframesDir, "assets/fonts"), rel: "assets/fonts" },
    { abs: join(hyperframesDir, "capture/assets/fonts"), rel: "capture/assets/fonts" },
  ].filter((d) => existsSync(d.abs));
  const weightOf = (n) => {
    const s = n.toLowerCase();
    if (/black|heavy|ultra|extrabold/.test(s)) return 800;
    if (/semibold|demibold/.test(s)) return 600; // before /bold/ — "demibold" contains "bold"
    if (/bold/.test(s)) return 700;
    if (/medium/.test(s)) return 500;
    if (/light|thin/.test(s)) return 300;
    return 400; // book / regular / roman
  };
  const fmtOf = (f) =>
    /\.woff2$/i.test(f)
      ? "woff2"
      : /\.woff$/i.test(f)
        ? "woff"
        : /\.ttf$/i.test(f)
          ? "truetype"
          : "opentype";
  // Normalize away ALL non-alphanumerics (spaces, underscores, hyphens) on BOTH the
  // family name and the filename. Real font files use "_" / "-" as word separators
  // ("TT_Norms_Pro_Bold.woff2"), so stripping only whitespace never matched them — the
  // family key "ttnormspro" failed `startsWith` against "tt_norms_pro_bold", and the
  // function silently returned "" → captions shipped with NO @font-face for any
  // underscore/hyphen-named brand font (e.g. TT Norms Pro), which is exactly the
  // font_family_without_font_face bug.
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const faces = [];
  const seen = new Set();
  const claimed = new Set(); // each file is claimed by the MOST SPECIFIC family only
  // Match the longest family key first so "TT Norms Pro" can't swallow the files that
  // belong to "TT Norms Pro Mono" (its key is a prefix of the longer one's).
  const ranked = [...families].sort((a, b) => norm(b).length - norm(a).length);
  for (const fam of ranked) {
    const key = norm(fam);
    for (const d of dirs) {
      let files = [];
      try {
        files = readdirSync(d.abs);
      } catch {
        continue;
      }
      for (const f of files.sort()) {
        if (!/\.(woff2|woff|ttf|otf)$/i.test(f)) continue;
        if (claimed.has(f)) continue; // a more specific family already took this file
        if (!norm(f.replace(/\.(woff2|woff|ttf|otf)$/i, "")).startsWith(key)) continue;
        const w = weightOf(f);
        const dedup = `${fam}-${w}`;
        if (seen.has(dedup)) continue; // one src per weight; assets/fonts wins over capture
        seen.add(dedup);
        claimed.add(f);
        faces.push(
          `      @font-face { font-family: '${fam}'; src: url('${d.rel}/${f}') format('${fmtOf(f)}'); font-weight: ${w}; font-display: block; }`,
        );
      }
    }
  }
  // Loud signal instead of a silent "". If frame.md named a brand font but no file
  // matched, the caption text WILL fall back to a generic font in the render — surface
  // the cause here (at build time) rather than letting it surface 2 steps later as a
  // font_family_without_font_face lint error disconnected from its root cause.
  if (!faces.length) {
    const where = dirs.length
      ? dirs.map((d) => d.rel).join(" / ")
      : "assets/fonts or capture/assets/fonts (neither exists)";
    console.warn(
      `  ⚠ captions: frame.md names font ${families.map((f) => `"${f}"`).join(", ")} ` +
        `but no matching .woff2/.woff/.ttf/.otf was found in ${where} — captions will fall back ` +
        `(text may render in the wrong font). Stage a font file whose name starts with the family ` +
        `(e.g. "TT Norms Pro" → TT_Norms_Pro_Bold.woff2) so it ships with the project.`,
    );
  }
  return faces.join("\n");
}

// frame.md colors:/typography: → a :root token block, mapped to the fixed semantic
// vocab every preset skin references. Robust to per-preset key names: colors are
// matched by name, then by luminance. Brand-token overlay (Step 2) flows through
// because the values come from the project's frame.md. No frame.md → band vars only.
function frameTokensCss(framePath, H) {
  const band = captionBand(H);
  const out = [];
  if (existsSync(framePath)) {
    const md = readFileSync(framePath, "utf8");
    const colors = parseColors(md);
    for (const [k, v] of colors) out.push(`      --${k}: ${v};`); // raw, for completeness
    const sem = semanticColors(colors);
    if (sem.ink) out.push(`      --cap-ink: ${sem.ink};`);
    if (sem.canvas) out.push(`      --cap-canvas: ${sem.canvas};`);
    if (sem.accent) out.push(`      --cap-accent: ${sem.accent};`);
    if (sem.accent2) out.push(`      --cap-accent-2: ${sem.accent2};`);
    const { display, body } = parseFonts(md);
    if (display) out.push(`      --font-display: ${display}, system-ui, serif;`);
    if (body) out.push(`      --font-body: ${body}, system-ui, sans-serif;`);
  }
  out.push(`      --cap-band-top: ${band.bandTopY}px;`);
  out.push(`      --cap-band-height: ${band.bandHeight}px;`);
  return `      :root {\n${out.join("\n")}\n      }`;
}

// ── default path (no preset skin) ─────────────────────────────────────────────
// Self-contained captions sub-composition. The <template> holds the band container
// + style AND the <script> (the HyperFrames loader only executes scripts INSIDE the
// cloned template — a sibling <script> after </template> never runs, so the timeline
// never registers and captions render blank). The script builds per-word spans and a
// paused, seek-safe GSAP timeline (opacity for group show/hide, a quick color tween
// per word for the karaoke highlight — no className flips, no JS state) and ends each
// group with a hard tl.set kill so an exit can't get stuck. gsap is loaded via CDN
// inside the template (matching the frame compositions). Band = captionBand(H).
function buildCaptionsHtml(groups, total, W, H) {
  const band = captionBand(H);
  const fs = Math.round(H * 0.038);
  const pad = Math.round(fs * 0.4);
  return `<template id="captions-template">
  <div
    data-composition-id="captions"
    data-width="${W}"
    data-height="${H}"
    data-duration="${total}"
    id="captions-root"
  >
    <div id="cap"></div>
  </div>
  <style>
    #captions-root {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }
#cap {
      position: absolute;
      left: 0;
      right: 0;
      top: ${band.bandTopY}px;
      height: ${band.bandHeight}px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
.caption-group {
      position: absolute;
      max-width: 80%;
      padding: ${pad}px ${Math.round(pad * 1.8)}px;
      background: rgba(0, 0, 0, 0.72);
      border-radius: ${Math.round(fs * 0.3)}px;
      font-family: Roboto, sans-serif;
      font-weight: 700;
      font-size: ${fs}px;
      line-height: 1.25;
      text-align: center;
      color: #fff;
      opacity: 0;
    }
.caption-word {
      color: rgba(255, 255, 255, 0.55);
    }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <script>
    (function () {
      var GROUPS = ${JSON.stringify(groups)};
      var cap = document.getElementById("cap");
      var tl = gsap.timeline({ paused: true });
      GROUPS.forEach(function (g) {
        var el = document.createElement("div");
        el.className = "caption-group";
        g.words.forEach(function (w) {
          var s = document.createElement("span");
          s.className = "caption-word";
          s.textContent = w.text + " ";
          el.appendChild(s);
        });
        cap.appendChild(el);
        tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.18, overwrite: "auto" }, g.start);
        tl.to(el, { opacity: 0, duration: 0.12, overwrite: "auto" }, g.end);
        tl.set(el, { opacity: 0, visibility: "hidden" }, g.end + 0.12); // deterministic hard kill
        g.words.forEach(function (w, i) {
          tl.to(el.children[i], { color: "#ffffff", duration: 0.06 }, w.start);
        });
      });
      tl.to({}, { duration: ${total} }, 0); // full-span anchor
      window.__timelines = window.__timelines || {};
      window.__timelines["captions"] = tl;
    })();
  </script>
</template>
`;
}

const sub = process.argv[2];
if (sub === "build" || sub === undefined) runBuild(process.argv.slice(sub === "build" ? 3 : 2));
else {
  console.error(
    "usage: node captions.mjs build [--storyboard …] [--audio-meta …] [--hyperframes .]",
  );
  process.exit(2);
}
