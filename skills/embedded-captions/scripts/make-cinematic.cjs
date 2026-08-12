#!/usr/bin/env node
/*
 * make-cinematic.cjs — compile cinematic.json → plan.json (then make-composition.cjs).
 * CINEMATIC MODE, raised to BLOCK level. The agent authors thought-BLOCKS — lines of
 * words, which plane each block stacks in, at most one promoted HERO word — and the
 * compiler lowers that into the classic plan.json with everything deterministic
 * generated, so the Cinematic failure modes seen in the wild become impossible:
 *   - READING ORDER by construction: lines stack in declaration order inside a flex
 *     plane (spoken order = visual order; a hero can never sit below later words)
 *   - timings from the transcript BY SEQUENCE (no hand-copied times; duplicates by position)
 *   - accumulate-within-block / page-flip-between-blocks rhythm generated:
 *     lines of a block share the block's out (they accumulate, then clear together
 *     when the next block's first word lands); the NEXT block enters fresh
 *   - hero hand-off: the promoted word is lifted OUT of its line, enters as the hero
 *     (its own plane, BIG) when spoken, holds to the END of its block, exits cleanly
 *   - fg fallback: safe-zones verdict "fg" → caption_layer:"fg" automatically
 *
 *   node make-cinematic.cjs <project-dir>
 *
 * cinematic.json schema:
 * {
 *   "template": "cinematic-cream",
 *   "width": 1920, "height": 1080, "fps": 30,
 *   "planes": {                       // layout REGIONS — place them using safe-zones.json
 *     "narr": "top: 14%; left: 4%; width: 26%;",            // string or {css}
 *     "hero": null                    // null/absent → auto from safe-zones heroAnchor
 *   },
 *   "blocks": [
 *     { "plane": "narr", "lines": [
 *         { "words": ["You","need","to"],        "css": "font-size: calc(0.05*var(--h)); font-weight:600;" },
 *         { "words": ["judge","us","by","the"],  "css": "font-size: calc(0.062*var(--h)); font-weight:700;" },
 *         { "words": ["actions"],                "hero": true,
 *           "text": "ACTIONS", "css": "font-size: calc(0.24*var(--h)); font-weight:900; text-transform:uppercase;" },
 *         { "words": ["that","we","take."],      "css": "font-size: calc(0.05*var(--h));" },
 *         // per-line escape hatch: "layer":"fg" lifts a line ABOVE the subject matte
 *         // (use when the occlusion gate reports a context line eaten by the subject)
 *         { "words": ["over","the","subject"],     "layer": "fg" }
 *       ] },
 *     { "plane": "narr", "lines": [ ... next thought ... ] }
 *   ],
 *   "tones": { "default": "soft", "hero": "present" }       // optional
 * }
 * Rules: words must match the transcript verbatim in spoken order across all blocks.
 * Mark at most ONE line "hero": true per clip (scarcity); its words form the hero
 * (usually a single word; "text" overrides the display form).
 */
const path = require("path");
const fs = require("fs");

const norm = (s) =>
  String(s == null ? "" : s)
    .toLowerCase()
    .replace(/[^a-z0-9']/g, "");
const LOOKAHEAD = 40;

// Authored css WITHOUT a font-size renders at browser-default ~16px (an
// invisible ribbon) and every gate still passes — observed in the cold-start
// E2E. Guarantee the default is present whenever the author omitted it.
function ensureFontSize(css, defaultDecl) {
  if (!css) return defaultDecl;
  return /font-size\s*:/.test(css) ? css : defaultDecl + " " + css;
}

function die(m) {
  console.error(`[make-cinematic] ${m}`);
  process.exit(1);
}

function main() {
  const project = path.resolve(process.argv[2] || "");
  if (!process.argv[2]) die("usage: make-cinematic.cjs <project-dir>");
  const cj = path.join(project, "cinematic.json");
  const tj = path.join(project, "transcript.json");
  if (!fs.existsSync(cj)) die(`missing ${cj} — author it first (schema in this header)`);
  if (!fs.existsSync(tj)) die(`missing ${tj} — run prepare.sh first`);
  const C = JSON.parse(fs.readFileSync(cj, "utf8"));
  const tr = (JSON.parse(fs.readFileSync(tj, "utf8")).words || []).filter(
    (w) => w && "start" in w && "end" in w,
  );
  if (!tr.length) die("transcript has no word timings");

  // safe-zones: fg verdict + heroAnchor default
  let sz = null;
  try {
    sz = JSON.parse(fs.readFileSync(path.join(project, "safe-zones.json"), "utf8"));
  } catch {}
  // author override first (borderline scenes: coverage near the line, agitated subject),
  // else the safe-zones verdict.
  // narration legibility follows the verdict; the HERO is judged separately — it WANTS
  // occlusion (~30–55% is the product). fg for the hero is the LAST resort: only when no
  // height band achieves ≤62% predicted occlusion (safe-zones heroBands). An explicit
  // author caption_layer:"fg" still forces everything front.
  const authorFg = C.caption_layer === "fg";
  const narrFg = authorFg || (sz && sz.recommendation === "fg");
  const hb = sz && sz.heroBands;
  const heroFeasible = authorFg ? false : hb ? hb.feasible : !narrFg;
  const globalFg = narrFg; // narration layer (name kept for the lowering below)

  const W = C.width || 1920,
    H = C.height || 1080,
    FPS = C.fps || 24;
  const blocks = C.blocks || [];
  if (!blocks.length) die("blocks is empty");

  // ── sequence-match every word across blocks/lines ──────────────────────────
  let p = 0;
  const missing = [];
  for (const b of blocks)
    for (const ln of b.lines || []) {
      ln._w = (ln.words || []).map((text) => {
        const t = norm(text);
        let f = -1;
        for (let j = p; j < Math.min(tr.length, p + LOOKAHEAD); j++)
          if (norm(tr[j].text) === t) {
            f = j;
            break;
          }
        if (f < 0) {
          missing.push(text);
          return { text, start: null, end: null };
        }
        p = f + 1;
        return { text, start: tr[f].start, end: tr[f].end, ti: f };
      });
    }
  if (missing.length)
    die(
      `words not in transcript (in order): ${missing.join(" ")} — lines must match the transcript verbatim`,
    );

  // COMPLETENESS GATE — verbatim is a hard rule, so enforce it at compile time: the
  // sequence matcher's lookahead can silently SKIP transcript words the author forgot
  // (a real case shipped missing "in our newly released model."). Every transcript word
  // must be consumed; the only legitimate drops are filler (um/uh/stutters), declared in
  // cinematic.json "drops": ["um", ...].
  {
    const consumed = new Set();
    for (const b of blocks)
      for (const ln of b.lines || []) for (const w of ln._w) if (w.ti != null) consumed.add(w.ti);
    const dropOk = new Set((C.drops || []).map(norm));
    const FILLER = new Set(["um", "uh", "er", "ah", "hmm", "mm"]);
    const skipped = tr
      .map((w, i) => ({ w, i }))
      .filter(
        ({ w, i }) => !consumed.has(i) && !dropOk.has(norm(w.text)) && !FILLER.has(norm(w.text)),
      );
    if (skipped.length)
      die(
        `VERBATIM VIOLATION — ${skipped.length} transcript word(s) never authored (the matcher skipped them): ` +
          `${skipped.map(({ w }) => `"${w.text}"`).join(" ")} — add them to a line, or declare true filler in "drops": []`,
      );
  }

  // text override + multiple words double-renders (override replaces word 1, words
  // 2..n still draw) — caught cold by a clean-room agent; illegal for ANY hero line.
  for (const b of blocks)
    for (const ln of b.lines || []) {
      if (ln.hero && ln.text && (ln.words || []).length > 1)
        die(
          `hero line ["${(ln.words || []).join('" "')}"] has BOTH multiple words and a "text" override — drop "text" (words render verbatim; DNA case applies) or promote a single word.`,
        );
    }

  // ── block windows: in = first word −lead; out = page-flip = next block's first word −0.28 (or +1.2 hold) ──
  const LEAD = 0.18;
  const bw = blocks.map((b) => {
    const ws = (b.lines || []).flatMap((l) => l._w);
    return { first: Math.min(...ws.map((w) => w.start)), last: Math.max(...ws.map((w) => w.end)) };
  });
  let srcDur = null;
  try {
    const cp = require("child_process");
    for (const f of ["source.mp4"].concat(
      fs.readdirSync(project).filter((x) => /\.(mp4|mov|webm)$/i.test(x)),
    )) {
      const fp = path.join(project, f);
      if (!fs.existsSync(fp)) continue;
      const d = parseFloat(
        cp.execFileSync(
          "ffprobe",
          [
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=nokey=1:noprint_wrappers=1",
            "--",
            fp,
          ],
          { encoding: "utf8" },
        ),
      );
      if (d > 0) {
        srcDur = d;
        break;
      }
    }
  } catch {}
  const DUR = +(srcDur || bw[bw.length - 1].last + 0.6).toFixed(3);
  // ── SLOT layout + paging. Lines get FIXED absolute positions (no flex reflow — the
  // "lower line jumps up when the upper one clears" bug is impossible by construction).
  // Lines accumulate down the plane like a poem; the plane PAGE-FLIPS (all visible lines
  // clear together, the next line restarts at the top) only when (a) the plane is full,
  // (b) a block sets "flip": true, or (c) a block boundary coincides with a real speech
  // pause (≥0.6s). Block windows (bw) are kept only for the hero's hold.
  for (let i = 0; i < bw.length; i++) {
    bw[i].in = Math.max(0, bw[i].first - LEAD);
    bw[i].out = Math.min(DUR - 0.05, Math.min(bw[i].last, DUR - 0.05) + 0.9);
    // a block's hold (incl. a LOCKUP's) yields to the NEXT block's entrance — the same
    // page-flip semantics columns already have; floor: its own words must finish
    if (i + 1 < bw.length)
      bw[i].out = Math.max(
        Math.min(bw[i].last, DUR - 0.05) + 0.15,
        Math.min(bw[i].out, bw[i + 1].first - 0.28),
      );
  }
  const fracOfLine = (css) => {
    const m = (css || "").match(/font-size\s*:\s*calc\(\s*([\d.]+)\s*\*\s*var\(--h\)/);
    return m ? +m[1] : 0.05;
  };
  const planeBudgetPx = (pk) => {
    const css =
      (C.planes &&
        C.planes[pk] &&
        (typeof C.planes[pk] === "string" ? C.planes[pk] : C.planes[pk].css)) ||
      "";
    const m = css.match(/height\s*:\s*([\d.]+)%/);
    return (m ? +m[1] / 100 : 0.3) * H;
  };

  // ── planes: agent's + auto LOCKUP planes (one per hero block) ───────────────
  // The LOCKUP is the layout answer to "the sentence reads broken around the hero":
  // a hero block's lines do NOT scatter into the narration column — kicker, HERO and
  // tail compose as ONE bonded ORBIT (context anchored at the hero's edges, diagonal
  // read). DEPTH: context EMBEDS (bg) with the hero — one shared depth; per-line
  // `layer:"fg"` is the escape hatch when the matte eats a context line (gate tells you).
  const planes = {};
  for (const [k, v] of Object.entries(C.planes || {})) {
    if (v == null) continue;
    let css = typeof v === "string" ? v : v.css || "";
    if (!/text-align\s*:/.test(css)) css += " text-align:center;"; // slot children are absolute; only alignment carries
    planes[k] = { css };
  }
  // multiple heroes allowed — scarcity is per BLOCK (≤1 per thought), not per clip.
  // The LARGEST authored hero is the APEX: it gets the full lockup embed (centered on
  // the subject, matte showcase). Smaller heroes are MINOR peaks: they stay IN their
  // column's flow as oversized emphasis lines (fg, hero motion at reduced amplitude) —
  // not every beat needs the matte showcase; that's what keeps the apex an event.
  const allHeroBlocks = [];
  blocks.forEach((b, bi) => {
    const hs = (b.lines || []).filter((l) => l.hero === true);
    if (hs.length > 1)
      die(
        `block ${bi} has ${hs.length} hero lines — at most ONE hero per block (scarcity = per beat)`,
      );
    if (hs.length === 1)
      allHeroBlocks.push({ b, bi, ln: hs[0], frac: fracOfLine(hs[0].css) || 0.24 });
  });
  const apexFracAll = Math.max(...allHeroBlocks.map((h) => h.frac), 0);
  // placement: "column" keeps even an APEX in its column's flow (the hero bursts the
  // column instead of crossing the subject) — the sanctioned alternative to the
  // subject-anchored lockup. Author it per hero line: { "hero": true, "placement": "column" }.
  const heroBlocks = allHeroBlocks.filter(
    (h) => h.frac >= apexFracAll - 1e-6 && (h.ln.placement || "subject") !== "column",
  );
  const minorHeroBis = new Set(
    allHeroBlocks
      .filter((h) => h.frac < apexFracAll - 1e-6 || (h.ln.placement || "subject") === "column")
      .map((h) => h.bi),
  );
  const columnApexBis = new Set(
    allHeroBlocks
      .filter((h) => h.frac >= apexFracAll - 1e-6 && (h.ln.placement || "subject") === "column")
      .map((h) => h.bi),
  );
  if (minorHeroBis.size)
    console.log(
      `[make-cinematic] ${minorHeroBis.size} minor hero(es) stay in the column flow (apex gets the lockup embed)`,
    );
  const lockupName = (bi) => `lockup-b${bi}`;
  const lockupTemplate =
    C.planes && C.planes.lockup
      ? typeof C.planes.lockup === "string"
        ? C.planes.lockup
        : C.planes.lockup.css
      : null;
  delete planes.lockup; // template only — not a real plane
  for (const hRef of heroBlocks) {
    const a = sz && sz.heroAnchor && sz.heroAnchor.plane;
    // band pick: target ~40% occlusion AND a band the DNA's text can survive on
    // (skip bright bands when luma data exists) — heroAnchor.yPct is the fallback
    let heroTop = a ? a.yPct : 30;
    if (hb && hb.profile && hb.profile.length) {
      const ok = hb.profile.filter(
        (b2) => b2.occPct >= 12 && b2.occPct <= 62 && (b2.bgLuma == null || b2.bgLuma <= 165),
      );
      const pool = ok.length ? ok : hb.profile;
      const best = pool.reduce((x, y) =>
        Math.abs(y.occPct - 40) < Math.abs(x.occPct - 40) ? y : x,
      );
      heroTop = +(best.topPct + 6.5).toFixed(1);
    }
    const heroFrac = (hRef.ln.css || "").match(/calc\(\s*([\d.]+)\s*\*\s*var\(--h\)/);
    // the lockup is taller than the hero alone (context above+below) — anchor so the
    // HERO band (not the plane top) lands on the target, then clamp so the WHOLE
    // lockup (pre + hero + post) stays on frame
    const heroIdx2 = (hRef.b.lines || []).indexOf(hRef.ln);
    const preH = (hRef.b.lines || [])
      .filter((l, i) => l !== hRef.ln && i < heroIdx2)
      .reduce(
        (s, l) =>
          s + (fracOfLine(l.css) * 100 * 1.32 + Math.max(1.6, fracOfLine(l.css) * 100 * 0.38)),
        0,
      );
    const postH = (hRef.b.lines || [])
      .filter((l, i) => l !== hRef.ln && i > heroIdx2)
      .reduce(
        (s, l) =>
          s + (fracOfLine(l.css) * 100 * 1.32 + Math.max(1.6, fracOfLine(l.css) * 100 * 0.38)),
        0,
      );
    const heroHpct = (heroFrac ? +heroFrac[1] : 0.24) * 100 * 1.12;
    const totalH = preH + heroHpct + postH;
    let top = +Math.max(2, Math.min(96 - totalH, heroTop - heroHpct / 2 - preH)).toFixed(1);
    const css = lockupTemplate
      ? lockupTemplate.replace(/top:\s*[\d.]+%/, `top: ${top}%`)
      : a
        ? `top: ${top}%; left: ${a.xPct}%; width: ${a.wPct}%; text-align: center;`
        : `top: ${top}%; left: 6%; width: 88%; text-align: center;`;
    planes[lockupName(hRef.bi)] = { css };
    hRef.plane = lockupName(hRef.bi);
  }
  // legacy alias: an author-defined "hero" plane positions the FIRST lockup
  if (planes.hero) {
    if (heroBlocks.length) {
      planes[lockupName(heroBlocks[0].bi)] = planes.hero;
    }
    delete planes.hero;
  }

  // ── PER-PLANE LEGIBILITY COMPENSATION ────────────────────────────────────
  // The DNA fixes hue + blend; the SCENE decides whether that survives. Match each
  // plane to its best-overlapping measured zone and ladder the treatment:
  //   luma > 150 → opaque (blend:normal) + strong tight scrim — screen/blend washes out
  //   luma 95–150 → keep the DNA blend, strengthen the glyph scrim
  const planeComp = {};
  if (sz && sz.zones) {
    const zlist = Object.entries(sz.zones).filter(([, z]) => z && z.meanLuma != null);
    for (const [pk, pv] of Object.entries(C.planes || {})) {
      const css0 = typeof pv === "string" ? pv : (pv || {}).css || "";
      const lm = css0.match(/left:\s*([\d.]+)%/),
        wm = css0.match(/width:\s*([\d.]+)%/);
      if (!lm || !wm) continue;
      const a0 = +lm[1],
        a1 = a0 + +wm[1];
      let best = null,
        bestOv = 0;
      for (const [, z] of zlist) {
        const ov = Math.min(a1, z.xPct + z.wPct) - Math.max(a0, z.xPct);
        if (ov > bestOv) {
          bestOv = ov;
          best = z;
        }
      }
      if (!best) continue;
      // gate on the time PEAK too — a dark wall swept by a bright moving object
      // (handheld drift, screens) averages "clean" but peaks hot, and text there
      // washes out exactly when the bright thing passes (real cold-start case)
      const pkL = best.peakLuma != null ? best.peakLuma : best.meanLuma;
      if (best.meanLuma > 150 || pkL > 175)
        planeComp[pk] =
          " mix-blend-mode: normal; text-shadow: 0 1px 6px rgba(0,0,0,.65), 0 2px 16px rgba(0,0,0,.4);";
      else if (best.meanLuma > 95 || pkL > 135)
        planeComp[pk] = " text-shadow: 0 1px 5px rgba(0,0,0,.6), 0 2px 14px rgba(0,0,0,.35);";
      if (planeComp[pk])
        console.log(
          `[make-cinematic] plane "${pk}" zone luma ${best.meanLuma} (peak ${pkL}) → legibility compensation (${best.meanLuma > 150 || pkL > 175 ? "opaque+scrim" : "scrim"})`,
        );
    }
  }
  // lockup context shares the hero band's luma
  const bandLuma = sz && sz.heroAnchor && sz.heroAnchor.bandLuma;
  const lockupComp =
    bandLuma != null && bandLuma > 150
      ? " mix-blend-mode: normal; text-shadow: 0 1px 6px rgba(0,0,0,.65), 0 2px 16px rgba(0,0,0,.4);"
      : bandLuma != null && bandLuma > 95
        ? " text-shadow: 0 1px 5px rgba(0,0,0,.6), 0 2px 14px rgba(0,0,0,.35);"
        : "";

  // ── lower to classic plan.json groups (slot layout + per-plane paging) ─────
  const tones = C.tones || {};
  let dnaBodyLayer = null;
  try {
    const dnaLib0 = require("./lib-dna.cjs");
    const dn0 = C.dna || (C.template ? dnaLib0.LEGACY[C.template] : "cream");
    if (dn0) {
      const d0 = dnaLib0.load(dn0);
      dnaBodyLayer = d0.bodyLayer || null;
      // category lock (symmetric): column is every classic DNA's home today,
      // so this only fires if a future DNA declares a different home.
      if (d0.deliveries && d0.deliveries.home && d0.deliveries.home !== "column")
        console.warn(
          `[make-cinematic] WARN: DNA "${dn0}" declares home="${d0.deliveries.home}" — cinematic use is cross-category and unvalidated.`,
        );
    }
  } catch (e) {
    if (e.message && e.message.includes("does not support")) throw e;
  }
  const groups = [];
  const heroRefs = heroBlocks; // [{b, bi, ln, plane}]
  const isHeroBlock = new Set(heroBlocks.map((h) => h.bi));
  const flat = [];
  blocks.forEach((b, bi) => {
    const heroIdx = isHeroBlock.has(bi) ? (b.lines || []).findIndex((l) => l.hero === true) : -1;
    (b.lines || []).forEach((ln, li) => {
      if (ln.hero === true && isHeroBlock.has(bi)) return; // APEX heroes slot into their lockup below
      flat.push({
        b,
        bi,
        ln,
        plane: heroIdx >= 0 ? lockupName(bi) : b.plane,
        lockupPos: heroIdx >= 0 ? (li < heroIdx ? "pre" : "post") : null,
        isMinorHero: ln.hero === true && minorHeroBis.has(bi), // minor peak rides its column
        first: Math.min(...ln._w.map((w) => w.start)),
        lastEnd: Math.min(Math.max(...ln._w.map((w) => w.end)), DUR - 0.05),
        frac: fracOfLine(ln.css),
      });
    });
  });
  // size sanity: narration below 0.05·h is whisper-tier (36px at 720p) — warn loudly
  {
    const tiny = flat.filter((l) => !l.isMinorHero && l.frac > 0 && l.frac < 0.05);
    if (tiny.length)
      console.log(
        `[make-cinematic] ⚠ ${tiny.length} narration line(s) authored below 0.05·h (whisper tier) — body narration wants 0.055–0.07·h: ${tiny
          .slice(0, 3)
          .map((l) => `"${l.ln.words.slice(0, 3).join(" ")}…"`)
          .join(" ")}`,
      );
  }
  // RATIO LOCK — poster lockup typography: context is sized FROM the hero, the way a
  // title system locks its eyebrow/tagline (kicker & tail ≈ 0.26× the hero height,
  // clamped to [0.05, 0.085]·h). Hero dominance is structural (~4× height + weight
  // contrast), so the old mass-rule downscale is gone — whisper-small context was the
  // disease, not the cure. Too MUCH context is a line-count problem, never a size one.
  for (const hRef of heroRefs) {
    const ctx = flat.filter((l) => l.bi === hRef.bi);
    if (!ctx.length) continue;
    const heroFracV = fracOfLine(hRef.ln.css || "") || 0.24;
    const ratioFrac = +Math.min(0.085, Math.max(0.05, heroFracV * 0.26)).toFixed(4);
    if (ctx.length > 3)
      console.log(
        `[make-cinematic] ⚠ lockup-b${hRef.bi} has ${ctx.length} context lines — a lockup wants kicker + hero + tail; move narration to the column (a leading clause can be its own block)`,
      );
    const moved = ctx.filter((l) => Math.abs(l.frac - ratioFrac) > 0.002).length;
    ctx.forEach((l) => {
      l.ln.css = (l.ln.css || "").replace(
        /font-size\s*:\s*[^;]+/,
        `font-size: calc(${ratioFrac} * var(--h))`,
      );
      l.frac = ratioFrac;
    });
    if (moved)
      console.log(
        `[make-cinematic] lockup-b${hRef.bi}: context RATIO-LOCKED to 0.26×hero → ${ratioFrac}·h (${moved} line(s) re-sized)`,
      );
  }
  const byPlane = {};
  flat.forEach((l) => {
    (byPlane[l.plane] = byPlane[l.plane] || []).push(l);
  });
  // make sure a lockup whose block has NO context lines still exists in the loop
  for (const hRef of heroRefs) if (!byPlane[hRef.plane]) byPlane[hRef.plane] = [];
  for (const [pk, ls] of Object.entries(byPlane)) {
    const isLockup = /^lockup-b/.test(pk);
    const budget = isLockup ? H : planeBudgetPx(pk); // a lockup is ONE composition — never paginate inside it
    const hRef = isLockup ? heroRefs.find((h) => h.plane === pk) : null;
    const heroH = hRef ? (fracOfLine(hRef.ln.css || "") || 0.24) * H * 1.12 + 12 : 0;
    // ORBIT estimate: where do the hero's left/right edges land inside the (frame-wide,
    // centered) lockup plane — kicker hangs off the left edge, tail off the right
    let orbit = null;
    if (hRef) {
      const disp = String(hRef.ln.text || (hRef.ln.words || []).join(" "));
      const fpx = (fracOfLine(hRef.ln.css || "") || 0.24) * H;
      const estW = Math.min(
        W * 0.94,
        Math.max(fpx * 1.2, disp.replace(/\s/g, "").length * fpx * 0.6),
      );
      const planeCss0 = (planes[pk] && planes[pk].css) || "";
      const _pl = ((planeCss0.match(/left:\s*([\d.]+)%/) || [0, 0])[1] * W) / 100;
      const pw = ((planeCss0.match(/width:\s*([\d.]+)%/) || [0, 100])[1] * W) / 100;
      const heroLeft = Math.max(0, (pw - estW) / 2);
      // side-aware: anchor context to the CLEANER side of THIS hero's window — the
      // kicker/tail must land on scene, not on a large/moving subject
      let side = (sz && sz.subject && sz.subject.clearerSide) || "left";
      try {
        const hin = Math.min(...hRef.ln._w.map((w) => w.start));
        const win = (sz.windows || []).find((w2) => hin >= w2.in - 0.3 && hin <= w2.out + 0.3);
        if (win && win.clearerSide) side = win.clearerSide;
      } catch {}
      orbit = {
        left: Math.round(heroLeft),
        right: Math.round(Math.max(0, pw - heroLeft - estW)),
        maxW: Math.round(Math.min(estW * 0.75, pw * 0.55)),
        side,
      };
    }
    const pages = [];
    let page = [],
      slot = 0;
    for (const l of ls) {
      // the HERO occupies its slot between pre- and post-context, in spoken order
      if (hRef && hRef.slotPx == null && l.lockupPos === "post") {
        hRef.slotPx = Math.round(slot);
        slot += heroH;
      }
      const lineH = l.frac * H * 1.32 + Math.max(12, Math.round(l.frac * H * 0.38)); // ink overflows the 1.0 line-box (+shadows) — breathe in proportion to the type
      const prev = page[page.length - 1];
      const pauseGap = prev ? l.first - prev.lastEnd : 0;
      const boundary = prev && l.bi !== prev.bi;
      // a block carrying a COLUMN-PLACED apex is one composition — never split it on
      // budget (the oversized hero legitimately exceeds the column's page height)
      const unbreakable = columnApexBis.has(l.bi) && prev && prev.bi === l.bi;
      if (
        page.length &&
        !unbreakable &&
        (slot + lineH > budget || (boundary && l.b.flip === true) || (boundary && pauseGap >= 0.6))
      ) {
        pages.push(page);
        page = [];
        slot = 0;
      }
      l.slotPx = Math.round(slot);
      if (isLockup) l._orbit = orbit;
      slot += lineH;
      page.push(l);
    }
    if (hRef && hRef.slotPx == null) {
      hRef.slotPx = Math.round(slot);
    } // hero is the block's last line
    if (page.length) pages.push(page);
    pages.forEach((pg, pi) => {
      const nextFirst = pi + 1 < pages.length ? pages[pi + 1][0].first : null;
      const maxEnd = Math.max(...pg.map((l) => l.lastEnd));
      let out =
        nextFirst != null
          ? Math.max(maxEnd + 0.01, Math.min(DUR - 0.05, nextFirst - 0.28))
          : Math.min(DUR - 0.05, maxEnd + 1.2);
      // THE LOCKUP OWNS THE FRAME: a sidebar page must not linger into an apex
      // lockup's window (its kicker/tail can land in the same zone → text-on-text)
      if (!isLockup)
        for (const hRef2 of heroRefs) {
          const lkIn = bw[hRef2.bi].first - 0.18;
          if (lkIn > maxEnd - 0.2 && lkIn < out)
            out = Math.max(maxEnd + 0.01, Math.min(out, lkIn - 0.28));
        }
      pg.forEach((l, li) => {
        l.pageIdx = pi;
        if (!isLockup)
          for (const hRef2 of heroRefs) {
            const lkOut = bw[hRef2.bi].out;
            const lkIn2 = bw[hRef2.bi].first - 0.18;
            const enter0 = Math.max(0, l.first - LEAD);
            if (enter0 > lkIn2 && enter0 < lkOut)
              l._delayIn = +Math.min(l.first, Math.max(enter0, lkOut - 0.2)).toFixed(3);
          }
        // a LOCKUP fades as ONE unit: context lines exit with the hero (block window),
        // never linger on page timing after the hero has left
        l.out = l.lockupPos ? +Math.min(out, bw[l.bi].out).toFixed(3) : +out.toFixed(3);
        l.in = l._delayIn != null ? l._delayIn : +Math.max(0, l.first - LEAD).toFixed(3);
        // first line of a NEW page: don't enter before the old page has begun clearing
        if (li === 0 && pi > 0)
          l.in = +Math.min(l.first, Math.max(l.first - LEAD, pages[pi - 1][0].out - 0.02)).toFixed(
            3,
          );
      });
    });
  }
  let gid = 0;
  for (const l of flat) {
    l.gid = l.isMinorHero ? `h-${l.bi}` : `b${l.bi}-l${gid++}`;
    // depth model: lockup CONTEXT embeds (bg) WITH the hero — the orbit anchors it
    // beside the head/shoulder so it reads on the scene, one shared depth; narration
    // columns embed too unless the DNA declares bodyLayer:"fg" (loud's announce-style).
    // Minor heroes ride their column in FRONT. Per-line layer overrides any default.
    // ORBIT depth: lockup context lands BESIDE the subject (kicker/tail at the hero's
    // edges) — so it EMBEDS (bg) like the hero; the whole composition shares one depth.
    // fg remains for: minor heroes (column emphasis), a DNA's bodyLayer (loud announces),
    // scene verdict FG (globalFg), and explicit per-line "layer" overrides.
    const defLayer = l.isMinorHero ? "fg" : dnaBodyLayer || "bg";
    groups.push({
      id: l.gid,
      plane: l.plane,
      layer: globalFg ? "fg" : l.ln.layer || l.b.layer || defLayer,
      ...(l.isMinorHero ? { hero: true, ...(columnApexBis.has(l.bi) ? {} : { minor: true }) } : {}),
      tone: l.isMinorHero ? tones.hero || "present" : l.ln.tone || tones.default || "soft",
      allow_overlap: true,
      // a MINOR hero holds only to the end of ITS thought (+a breath) — lingering with
      // the page through a long pause leaves it co-visible with the next apex
      in: l.in,
      out: l.isMinorHero ? +Math.min(l.out, bw[l.bi].out + 0.3).toFixed(3) : l.out,
      // carry the PLANE's text-align onto each slotted line (absolute children don't
      // reliably inherit through the template's .cap centering — authored "right edge
      // hugs the silhouette" was silently centered)
      css:
        (l.lockupPos && l._orbit
          ? (l.ln.anchor || (l.lockupPos === "pre" ? l._orbit.side : l._orbit.side)) === "left"
            ? `position:absolute;top:${l.slotPx}px;left:${l._orbit.left}px;right:auto;max-width:${l._orbit.maxW}px;text-align:left; `
            : `position:absolute;top:${l.slotPx}px;right:${l._orbit.right}px;left:auto;max-width:${l._orbit.maxW}px;text-align:right; `
          : `position:absolute;left:0;right:0;top:${l.slotPx}px; ` +
            (() => {
              const pc =
                (C.planes &&
                  C.planes[l.plane] &&
                  (typeof C.planes[l.plane] === "string"
                    ? C.planes[l.plane]
                    : C.planes[l.plane].css)) ||
                "";
              const ta = pc.match(/text-align\s*:\s*(left|right|center)/);
              return ta ? `text-align:${ta[1]}; ` : "";
            })()) +
        ensureFontSize(l.ln.css, "font-size: calc(0.05 * var(--h)); font-weight: 600;") +
        (l.lockupPos ? lockupComp : planeComp[l.plane] || ""),
      words: l.ln._w.map((w, wi2) => ({
        // minor/column heroes honor the display-form override too (single-word lines)
        text: l.isMinorHero && l.ln.text && wi2 === 0 && l.ln._w.length === 1 ? l.ln.text : w.text,
        start: w.start,
        end: Math.min(w.end, DUR - 0.05),
        ti: w.ti,
      })),
    });
  }
  for (const hRef of heroRefs) {
    const { bi, ln } = hRef;
    const w0 = ln._w[0];
    groups.push({
      id: `h-${bi}`,
      hero: true,
      plane: hRef.plane,
      layer: ln.layer || (heroFeasible ? "bg" : "fg"),
      tone: tones.hero || "present",
      allow_overlap: true,
      in: +Math.max(0, w0.start - 0.02).toFixed(3),
      out: +bw[bi].out.toFixed(3),
      css:
        `position:absolute;left:0;right:0;top:${hRef.slotPx || 0}px; text-align:center; ` +
        ensureFontSize(
          ln.css,
          "font-size: calc(0.24 * var(--h)); font-weight: 900; white-space: nowrap;",
        ), // case/tracking come from the DNA's hero treatment
      words: ln._w.map((w, i) => ({
        text: i === 0 && ln.text ? ln.text : w.text,
        start: w.start,
        end: Math.min(w.end, DUR - 0.05),
        ti: w.ti,
      })),
    });
    if (!heroFeasible)
      console.log(
        "[make-cinematic] no hero band ≤62% predicted occlusion → hero rendered in FRONT (last resort)",
      );
  }
  // scarcity spacing: heroes must breathe apart (≥ a beat between windows)
  const heroGs = groups.filter((g) => g.hero === true).sort((a, b) => a.in - b.in);
  for (let i = 1; i < heroGs.length; i++) {
    const gap = heroGs[i].in - heroGs[i - 1].out;
    if (gap < 0.6)
      console.log(
        `[make-cinematic] ⚠ heroes "${heroGs[i - 1].words[0].text}" and "${heroGs[i].words[0].text}" are only ${gap.toFixed(2)}s apart — peaks need a beat of air between them (consider demoting one to an emphasis line)`,
      );
  }
  // proximity: narration planes should HUG the silhouette (the embed reads as in-scene
  // only when typography interacts with the subject) — warn on far-parked planes.
  if (sz && sz.subject) {
    for (const [pk2, pv] of Object.entries(C.planes || {})) {
      if (/^lockup/.test(pk2) || pk2 === "hero" || pv == null) continue;
      const css2 = typeof pv === "string" ? pv : pv.css || "";
      const lm = css2.match(/left\s*:\s*([\d.]+)%/),
        wm = css2.match(/width\s*:\s*([\d.]+)%/);
      if (!lm || !wm) continue;
      const pl = +lm[1],
        pr = +lm[1] + +wm[1];
      const gap =
        pr <= sz.subject.colMinPct
          ? sz.subject.colMinPct - pr
          : pl >= sz.subject.colMaxPct
            ? pl - sz.subject.colMaxPct
            : 0;
      if (gap > 12)
        console.log(
          `[make-cinematic] ⚠ plane "${pk2}" sits ${gap.toFixed(0)}% away from the silhouette — embeds read in-scene when text HUGS the subject (use safe-zones zones.hugLeft/hugRight, gap 2–6%)`,
        );
    }
  }
  const plan = {
    mode: "template",
    dna: C.dna || (C.template ? undefined : "cream"), // canonical: name a DNA; default cream
    template: C.template || "cinematic-cream",
    compiled_by: "make-cinematic.cjs",
    width: W,
    height: H,
    fps: FPS,
    duration: DUR,
    ...(globalFg && (!heroRefs.length || !heroFeasible) ? { caption_layer: "fg" } : {}), // mixed narration-fg + hero-bg → per-group layers (hybrid render)
    planes: Object.fromEntries(Object.entries(planes).map(([k, v]) => [k, { css: v.css }])),
    groups,
  };
  fs.writeFileSync(path.join(project, "plan.json"), JSON.stringify(plan, null, 2));
  console.log(
    `[make-cinematic] ${blocks.length} block(s) → ${groups.length} group(s)` +
      `${heroRefs.length ? `, ${heroRefs.length} hero(es): ${heroRefs.map((h) => `"${h.ln.text || h.ln.words[0]}"`).join(" · ")} (each holds to its block end, lockup-composed)` : ""}` +
      `${globalFg ? ", caption_layer=fg (safe-zones verdict)" : ""}, canvas ${DUR}s`,
  );
  // straight into the existing template compiler
  const cp2 = require("child_process");
  let r = cp2.spawnSync("node", [path.join(__dirname, "make-composition.cjs"), project], {
    stdio: "inherit",
  });
  if ((r.status || 0) !== 0) process.exit(r.status);

  // ── RE-SLOT pass (real measurement). Compile-time slots assume each line renders as
  // ONE visual line; a narrow plane WRAPS long lines and the next slot overlaps the
  // wrapped tail. Measure every page's REAL text heights in Chromium and re-stack.
  {
    const textBoxH = (c) => {
      const ws = (c.words || []).filter((w) => (w.opacity ?? 1) > 0.05 && w.w > 0);
      if (!ws.length) return c.cap_bbox ? c.cap_bbox.h : 0;
      return Math.max(...ws.map((w) => w.y + w.h)) - Math.min(...ws.map((w) => w.y));
    };
    const pagesByKey = {};
    for (const l of flat) {
      const key = l.plane + "|" + (l.pageIdx || 0);
      (pagesByKey[key] = pagesByKey[key] || { t: +(l.out - 0.1).toFixed(2), lines: [] }).lines.push(
        l,
      );
    }
    // the HERO is a real member of its lockup's stack — re-slot must move it (and the
    // post-context below it) from MEASURED heights, or a wrapped pre-line / raised hero
    // font reopens the very overlap this pass exists to prevent
    for (const hRef of heroRefs) {
      const key = hRef.plane + "|0";
      const hg2 = groups.find((g2) => g2.id === `h-${hRef.bi}`);
      if (!hg2) continue;
      (pagesByKey[key] = pagesByKey[key] || {
        t: +(hg2.out - 0.1).toFixed(2),
        lines: [],
      }).lines.push({
        gid: hg2.id,
        slotPx: hRef.slotPx || 0,
        frac: fracOfLine(hg2.css) || 0.24,
        _hero: true,
      });
    }
    const times = [...new Set(Object.values(pagesByKey).map((pg) => pg.t))];
    if (times.length) {
      cp2.spawnSync(
        "node",
        [path.join(__dirname, "measure-layout.cjs"), project, ...times.map(String)],
        { stdio: "ignore", timeout: 120000 },
      );
      let lay = null;
      try {
        lay = JSON.parse(fs.readFileSync(path.join(project, "_layout.json"), "utf8"));
      } catch {}
      if (lay && lay.samples) {
        let changes = 0;
        for (const pg of Object.values(pagesByKey)) {
          const sample = lay.samples.reduce((a, b) =>
            Math.abs(b.t - pg.t) < Math.abs(a.t - pg.t) ? b : a,
          );
          if (!sample || Math.abs(sample.t - pg.t) > 0.3) continue;
          const ordered = [...pg.lines].sort((a, b) => a.slotPx - b.slotPx);
          let top = 0;
          for (const l of ordered) {
            const cap = (sample.caps || []).find((c) => c.id === l.gid);
            const realH = cap
              ? (cap.cap_bbox && cap.cap_bbox.h) || textBoxH(cap)
              : l.frac * H * 1.25;
            if (Math.abs(top - l.slotPx) > 3) {
              const g = groups.find((g2) => g2.id === l.gid);
              g.css = g.css.replace(/top:\s*-?[\d.]+px/, "top:" + Math.round(top) + "px");
              if (l._hero) {
                const hr = heroRefs.find((h) => `h-${h.bi}` === l.gid);
                if (hr) hr.slotPx = Math.round(top);
              }
              l.slotPx = Math.round(top);
              changes++;
            }
            top +=
              (realH || l.frac * H * 1.25) + Math.max(12, Math.round((l.frac || 0.05) * H * 0.38)); // box is lh1.12 — contains its own ink
          }
        }
        if (changes) {
          console.log(
            `[make-cinematic] re-slot: ${changes} line(s) re-stacked from MEASURED heights (wrapped lines accounted)`,
          );
          fs.writeFileSync(path.join(project, "plan.json"), JSON.stringify(plan, null, 2));
          cp2.spawnSync("node", [path.join(__dirname, "make-composition.cjs"), project], {
            stdio: "ignore",
          });
          try {
            fs.unlinkSync(path.join(project, "_layout.json"));
          } catch {}
        }
      }
    }
  }

  // ── HERO post-pass (real measurement, up to 2 re-emits) — runs PER HERO ─────
  // (a) SIZE: a timid hero is the #1 quality kill. If the authored font leaves >25%
  //     of the usable width unused, raise it to the width-fit maximum (DNA sizeRange cap).
  // (b) CLEARANCE vs OTHER planes: the hero band must not overlap caps outside its own
  //     lockup (its own context is composed around it by the slot layout). On a hit,
  //     shift the whole LOCKUP plane vertically.
  // (c) LOCKUP RE-STACK: a size change moves the hero's height — restack the lockup's
  //     slots from measured heights so post-context stays bonded BELOW the hero.
  // HERO words never wrap — a mid-word break ("Watermelo|n") is wrong in every case,
  // and author css REPLACES the default (which silently lost white-space:nowrap).
  // Forced here so no authoring path can drop it; centered nowrap text overflows a
  // narrow plane SYMMETRICALLY, which also keeps width-fit honest (it measures the
  // true single-line width instead of a wrapped row).
  // narration lines whipped away by a mid-sentence page-flip are the same disease
  // in mild form — warn (a deliberate quick beat is legal, so no die)
  for (const g of groups)
    if (!g.hero && g.words && g.words.length && g.out - g.in < 0.6) {
      console.log(
        `[make-cinematic] ⚠ line "${g.words
          .map((w) => w.text)
          .join(" ")
          .slice(
            0,
            28,
          )}" visible only ${(g.out - g.in).toFixed(2)}s (page-flip) — merge micro-lines or give the plane more height so the page holds`,
      );
    }
  // MIN DWELL — a peak on screen <0.5s is unreadable ("stars" shipped at 0.47s and
  // the user couldn't read it). Merge the block with the next (one thought), promote
  // a word with room, or demote to an emphasized line. <0.8s gets a loud warning.
  for (const g of groups)
    if (g.hero) {
      const dwell = g.out - g.in;
      if (dwell < 0.5)
        die(
          `hero "${(g.words[0] || {}).text}" is on screen only ${dwell.toFixed(2)}s (<0.5s readability floor) — merge its block with the next, promote a word with more room, or demote it to an emphasized (non-hero) line.`,
        );
      if (dwell < 0.8)
        console.log(
          `[make-cinematic] ⚠ hero "${(g.words[0] || {}).text}" dwell ${dwell.toFixed(2)}s is tight (<0.8s) — consider merging blocks so the peak can breathe`,
        );
    }
  {
    let nwChanged = false;
    for (const g of groups)
      if (g.hero && !/white-space\s*:\s*nowrap/.test(g.css || "")) {
        g.css = (g.css || "") + " white-space: nowrap;";
        nwChanged = true;
      }
    if (nwChanged) {
      fs.writeFileSync(path.join(project, "plan.json"), JSON.stringify(plan, null, 2));
      require("child_process").spawnSync(
        "node",
        [path.join(__dirname, "make-composition.cjs"), project],
        { stdio: "ignore" },
      );
    }
  }
  const fracOf = (css) => {
    const m = (css || "").match(/font-size\s*:\s*calc\(\s*([\d.]+)\s*\*\s*var\(--h\)/);
    return m ? +m[1] : null;
  };
  const setFrac = (css, f) =>
    (css || "").replace(
      /font-size\s*:\s*[^;]+/,
      "font-size: calc(" + f.toFixed(3) + " * var(--h))",
    );
  const textBox = (c) => {
    const ws = (c.words || []).filter((w) => (w.opacity ?? 1) > 0.05 && w.w > 0);
    if (!ws.length) return c.cap_bbox;
    const x0 = Math.min(...ws.map((w) => w.x)),
      x1 = Math.max(...ws.map((w) => w.x + w.w));
    const y0 = Math.min(...ws.map((w) => w.y)),
      y1 = Math.max(...ws.map((w) => w.y + w.h));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };
  let dnaSizeCap = 0.34,
    dnaHeroCase = "none";
  try {
    const dnaLib2 = require("./lib-dna.cjs");
    const dn = plan.dna || dnaLib2.LEGACY[plan.template];
    if (dn) {
      const dj = dnaLib2.load(dn);
      if (dj.hero && dj.hero.sizeRange) dnaSizeCap = dj.hero.sizeRange[1];
      if (dj.hero) dnaHeroCase = dj.hero.case || "none";
    }
  } catch {}
  // the APEX (largest authored hero) gets the width-fit raise; minor heroes keep their
  // authored size — inter-hero hierarchy is a deliberate choice, not timidity
  const apexFrac = Math.max(
    ...heroRefs.map((h) => fracOf((groups.find((g) => g.id === `h-${h.bi}`) || {}).css) || 0),
    0,
  );
  for (const hRef of heroRefs) {
    const heroG = groups.find((g) => g.id === `h-${hRef.bi}`);
    if (!heroG) continue;
    const isApex = (fracOf(heroG.css) || 0) >= apexFrac - 1e-6;
    const lockupMates = groups.filter((g) => g.plane === hRef.plane && g.id !== heroG.id);
    // hero size changed → context follows the 0.26 poster ratio, and its orbit
    // max-width scales WITH the font (a stale max-width wraps re-locked context
    // into multi-row towers that blow the stack past the frame)
    const relockMates = (hf) => {
      const rf = +Math.min(0.085, Math.max(0.05, hf * 0.26)).toFixed(4);
      for (const m of lockupMates) {
        const mf = fracOf(m.css);
        if (!mf || Math.abs(mf - rf) <= 0.002) continue;
        const scale = rf / mf;
        m.css = setFrac(m.css, rf).replace(
          /max-width:\s*([\d.]+)px/,
          (s2, px) => "max-width:" + Math.round(+px * scale) + "px",
        );
      }
    };
    const measure = () => {
      const midT = ((heroG.in + Math.min(heroG.out, heroG.in + 1.0)) / 2).toFixed(2);
      const endT = Math.max(+midT + 0.05, heroG.out - 0.12).toFixed(2);
      cp2.spawnSync(
        "node",
        [path.join(__dirname, "measure-layout.cjs"), project, String(midT), String(endT)],
        { stdio: "ignore", timeout: 90000 },
      );
      try {
        const ss = JSON.parse(fs.readFileSync(path.join(project, "_layout.json"), "utf8")).samples;
        const near = (t) =>
          ss.reduce((a, b) => (Math.abs(b.t - t) < Math.abs((a ? a.t : 1e9) - t) ? b : a), null);
        return { caps: (near(+midT) || {}).caps || [], capsEnd: (near(+endT) || {}).caps || [] };
      } catch {
        return null;
      }
    };
    let didRaise = false;
    for (let pass = 0; pass < 5; pass++) {
      const m0 = measure();
      if (!m0) break;
      const caps = m0.caps,
        capsEnd = m0.capsEnd && m0.capsEnd.length ? m0.capsEnd : m0.caps;
      const hc0 = caps.find((c) => c.id === heroG.id);
      if (!hc0 || !hc0.cap_bbox) break;
      const hc = { ...hc0, cap_bbox: textBox(hc0) };
      const mateIds = new Set(lockupMates.map((m) => m.id));
      const others = caps
        .filter(
          (c) =>
            c.id !== heroG.id &&
            !mateIds.has(c.id) &&
            !/-glow$/.test(c.id || "") &&
            c.cap_bbox &&
            c.opacity > 0.05,
        )
        .map((c) => ({ ...c, cap_bbox: textBox(c) }));
      const maxW = W * 0.94;
      const f0 = fracOf(heroG.css);
      let changed = false;
      if (f0 && hc.cap_bbox.w > 0) {
        if (hc.cap_bbox.w > maxW) {
          const nf = Math.max(0.06, (f0 * maxW) / hc.cap_bbox.w);
          console.log(
            `[make-cinematic] hero "${heroG.words[0].text}" too WIDE ${Math.round(hc.cap_bbox.w)}px → ${f0}h→${nf.toFixed(3)}h`,
          );
          heroG.css = setFrac(heroG.css, nf);
          changed = true;
        } else if (hc.cap_bbox.w >= maxW * 0.88) {
          if (pass === 0)
            console.log(
              `[make-cinematic] hero "${heroG.words[0].text}" at width CEILING (${Math.round(hc.cap_bbox.w)}/${Math.round(maxW)}px) — cannot enlarge.`,
            );
        } else if (!didRaise && hc.cap_bbox.w < maxW * 0.88 && isApex) {
          // NO DEAD ZONE: anything under 88% of usable width is raised toward a 93%
          // fill (the old <75% trigger let 75–88%-wide heroes stay merely "decent")
          const fit = (f0 * (maxW * 0.93)) / hc.cap_bbox.w;
          const nf = Math.min(dnaSizeCap, fit);
          if (nf > f0 * 1.05 || fit > dnaSizeCap * 1.02) {
            if (nf > f0 * 1.001)
              console.log(
                `[make-cinematic] hero "${heroG.words[0].text}" TIMID (${Math.round(hc.cap_bbox.w)}px of ${Math.round(maxW)}px usable) → ${f0}h→${nf.toFixed(3)}h (width-fit max)`,
              );
            // SHORT-WORD FILL: height cap bound before the width target → fill with
            // TRACKING (film-title craft — HER, DUNE), ≤0.32em so it stays a word.
            const wAtCap = (hc.cap_bbox.w * nf) / f0;
            const dispT = String(heroG.text || (heroG.words || []).map((w) => w.text).join(" "));
            // never letterspace lowercase (tracked lowercase falls apart — caps only)
            const capsy = dnaHeroCase === "uppercase" || dispT === dispT.toUpperCase();
            if (fit > dnaSizeCap && wAtCap < maxW * 0.85 && capsy) {
              const disp = dispT;
              // letter-spacing adds a gap after EVERY char (N gaps) and the centering
              // text-indent adds one more — budget N+1 gaps or the word leaves the frame
              const gaps = disp.length + 1;
              const tr = +Math.min(0.32, (maxW * 0.88 - wAtCap) / (gaps * nf * H)).toFixed(3);
              if (tr >= 0.04) {
                heroG.css =
                  heroG.css
                    .replace(/letter-spacing\s*:[^;]+;?\s*/g, "")
                    .replace(/text-indent\s*:[^;]+;?\s*/g, "") +
                  (heroG.css.trim().endsWith(";") || !heroG.css.trim() ? "" : ";") +
                  ` letter-spacing:${tr}em; text-indent:${tr}em;`;
                console.log(
                  `[make-cinematic] hero "${disp}" short word at height cap (${Math.round(wAtCap)}px of ${Math.round(maxW)}px) → tracked +${tr}em to fill`,
                );
              }
            }
            heroG.css = setFrac(heroG.css, nf);
            changed = true;
            didRaise = true;
            relockMates(nf);
          }
        }
      }
      const hbx = hc.cap_bbox;
      // colliders OUTSIDE the lockup only — the lockup composes around the hero by design
      const hits = others.filter((o) => {
        const b = o.cap_bbox;
        const ix = Math.min(hbx.x + hbx.w, b.x + b.w) - Math.max(hbx.x, b.x);
        const iy = Math.min(hbx.y + hbx.h, b.y + b.h) - Math.max(hbx.y, b.y);
        return ix > 8 && iy > 8;
      });
      if (hits.length) {
        const maxBottom = Math.max(...hits.map((o) => o.cap_bbox.y + o.cap_bbox.h));
        const minTop = Math.min(...hits.map((o) => o.cap_bbox.y));
        const downTo = ((maxBottom + 14) / H) * 100;
        const upTo = Math.max(2, ((minTop - hbx.h - 14) / H) * 100);
        const planeCss = plan.planes[hRef.plane].css;
        const curTop = +(planeCss.match(/top:\s*([\d.]+)%/) || [0, 30])[1];
        const newTop = downTo + (hbx.h / H) * 100 < 96 ? downTo : upTo;
        plan.planes[hRef.plane].css = planeCss.replace(
          /top:\s*[\d.]+%/,
          "top: " + newTop.toFixed(1) + "%",
        );
        console.log(
          `[make-cinematic] hero "${heroG.words[0].text}" OVERLAPS ${hits.map((o) => o.id).join(",")} — lockup top ${curTop}% → ${newTop.toFixed(1)}%`,
        );
        changed = true;
      }
      // ORBIT REFINE: anchor kicker/tail to the MEASURED hero edges (estimate → real)
      if (lockupMates.length && hc.cap_bbox && hc.cap_bbox.w > 0) {
        const planeCss2 = (plan.planes[hRef.plane] && plan.planes[hRef.plane].css) || "";
        const pl2 = ((planeCss2.match(/left:\s*([\d.]+)%/) || [0, 0])[1] * W) / 100;
        const relL = Math.max(0, Math.round(hc.cap_bbox.x - pl2));
        const pw2 = ((planeCss2.match(/width:\s*([\d.]+)%/) || [0, 100])[1] * W) / 100;
        const relR = Math.max(0, Math.round(pw2 - (hc.cap_bbox.x - pl2) - hc.cap_bbox.w));
        for (const m of lockupMates) {
          if (/left:\s*\d+px;right:auto/.test(m.css)) {
            const nc = m.css.replace(/left:\s*\d+px/, "left:" + relL + "px");
            if (nc !== m.css) {
              m.css = nc;
              changed = true;
            }
          } else if (/right:\s*\d+px;left:auto/.test(m.css)) {
            const nc = m.css.replace(/right:\s*\d+px/, "right:" + relR + "px");
            if (nc !== m.css) {
              m.css = nc;
              changed = true;
            }
          }
        }
      }
      // LOCKUP RE-STACK from measured heights — runs EVERY pass for lockups (orbit
      // max-widths wrap context lines, so the re-slot's estimates can leave the tail
      // displaced or the whole composition off frame)
      if (lockupMates.length) {
        const caps2 = capsEnd; // lockup-END sample: every context line is revealed there
        // TOWER CHECK — a context line wrapped to 3+ rows means its orbit max-width is
        // too narrow for the (re-locked) font; widen toward the plane before stacking,
        // or the tower blows the stack past the frame and the walk-back eats the hero
        for (const m of lockupMates) {
          const cm = caps2.find((x) => x.id === m.id);
          const frm = fracOf(m.css) || 0.05;
          const mwM = m.css.match(/max-width:\s*([\d.]+)px/);
          if (!cm || !cm.cap_bbox || !mwM) continue;
          const rows = Math.round(cm.cap_bbox.h / (frm * H * 1.12));
          if (rows >= 3) {
            const planeCssW2 = (plan.planes[hRef.plane] && plan.planes[hRef.plane].css) || "";
            const pwX = W * (+(planeCssW2.match(/width:\s*([\d.]+)%/) || [0, 92])[1] / 100);
            const nw = Math.round(pwX * 0.62);
            if (nw > +mwM[1] + 10) {
              m.css = m.css.replace(/max-width:\s*[\d.]+px/, "max-width:" + nw + "px");
              console.log(
                `[make-cinematic] context "${((m.words || [])[0] || {}).text}…" wrapped to ${rows} rows — orbit max-width ${Math.round(+mwM[1])}→${nw}px (towers break the stack)`,
              );
              changed = true;
            }
          }
        }
        const entries = [heroG, ...lockupMates]
          .map((g) => {
            const c = caps2.find((x) => x.id === g.id);
            const curTop = +(g.css.match(/top:\s*(-?[\d.]+)px/) || [0, 0])[1];
            const fr = fracOf(g.css) || 0.05;
            // SLOT HEIGHT = the LAYOUT box (cap_bbox), not the glyph box: words reveal
            // over time, so at the hero-mid sample a context line's later words are
            // still opacity-0 — glyph-box measured a wrapped line one row short and the
            // next line slotted INTO its wrap band (real text-on-text shipped).
            const measuredH = c && c.cap_bbox ? c.cap_bbox.h : null;
            const h2 = g.id === heroG.id && didRaise ? fr * H * 1.12 : measuredH || fr * H * 1.25;
            return { g, curTop, h: h2 };
          })
          .sort((a, b) => a.curTop - b.curTop);
        let top = 0;
        for (const e of entries) {
          if (Math.abs(top - e.curTop) > 3) {
            e.g.css = e.g.css.replace(/top:\s*-?[\d.]+px/, "top:" + Math.round(top) + "px");
            changed = true;
          }
          top += e.h + Math.max(12, Math.round((fracOf(e.g.css) || 0.05) * H * 0.38)); // box is lh1.12 — contains its own ink
        }
        // RE-CLAMP the plane after MEASURED growth — keep the whole composition on frame
        const planeCss3 = plan.planes[hRef.plane].css;
        const curTopPct = +(planeCss3.match(/top:\s*([\d.]+)%/) || [0, 30])[1];
        const maxTopPct = Math.max(2, ((H * 0.97 - top) / H) * 100);
        if (curTopPct > maxTopPct + 0.3) {
          plan.planes[hRef.plane].css = planeCss3.replace(
            /top:\s*[\d.]+%/,
            "top: " + maxTopPct.toFixed(1) + "%",
          );
          console.log(
            `[make-cinematic] lockup measured ${Math.round(top)}px tall — plane top ${curTopPct}% → ${maxTopPct.toFixed(1)}% (kept on frame)`,
          );
          changed = true;
        }
        // even at the 2% ceiling the stack can exceed the frame (TIMID raise + ratio
        // context on a tall lockup) — walk the hero back 8% and re-lock until it fits
        if (top > H * 0.95 && maxTopPct <= 2.01) {
          const f0c = fracOf(heroG.css);
          if (f0c && f0c > 0.14) {
            // decisive step: stack height scales ~linearly with the hero (context is
            // ratio-locked to it), so aim straight at a 93% fill instead of nibbling
            const nf2 = +Math.max(0.14, Math.min(f0c * 0.92, (f0c * (H * 0.93)) / top)).toFixed(3);
            console.log(
              `[make-cinematic] lockup stack ${Math.round(top)}px exceeds the frame even at top 2% — hero ${f0c}h → ${nf2}h (fit)`,
            );
            heroG.css = setFrac(heroG.css, nf2);
            relockMates(nf2);
            didRaise = true;
            changed = true;
          }
        }
      }
      if (!changed) break;
      fs.writeFileSync(path.join(project, "plan.json"), JSON.stringify(plan, null, 2));
      r = cp2.spawnSync("node", [path.join(__dirname, "make-composition.cjs"), project], {
        stdio: "ignore",
      });
      try {
        fs.unlinkSync(path.join(project, "_layout.json"));
      } catch {}
    }
  }
  // MINOR HERO measure pass — minors keep their authored size (hierarchy is a choice)
  // but never ship broken: wider than the frame's usable width shrinks to fit, and a
  // column overflow gets a loud note (centered spill is legal on a clear side only).
  {
    const minors = groups.filter((g) => g.hero && !heroRefs.some((h) => `h-${h.bi}` === g.id));
    let minorChanged = false;
    for (const mg of minors) {
      const midT = ((mg.in + Math.min(mg.out, mg.in + 1.0)) / 2).toFixed(2);
      cp2.spawnSync("node", [path.join(__dirname, "measure-layout.cjs"), project, String(midT)], {
        stdio: "ignore",
        timeout: 60000,
      });
      let mc = null;
      try {
        mc = (
          JSON.parse(fs.readFileSync(path.join(project, "_layout.json"), "utf8")).samples[0].caps ||
          []
        ).find((c) => c.id === mg.id);
      } catch {}
      if (!mc || !mc.cap_bbox) continue;
      const bb = textBox(mc),
        f0 = fracOf(mg.css);
      if (f0 && bb.w > W * 0.94) {
        const nf = Math.max(0.06, +((f0 * (W * 0.94)) / bb.w).toFixed(3));
        console.log(
          `[make-cinematic] minor hero "${(mg.words[0] || {}).text}" too WIDE ${Math.round(bb.w)}px → ${f0}h→${nf.toFixed(3)}h (shrink-to-fit)`,
        );
        mg.css = setFrac(mg.css, nf);
        minorChanged = true;
      } else {
        const planeCssM = (plan.planes[mg.plane] && plan.planes[mg.plane].css) || "";
        const pwPx = W * (+(planeCssM.match(/width:\s*([\d.]+)%/) || [0, 100])[1] / 100);
        if (bb.w > pwPx * 1.05)
          console.log(
            `[make-cinematic] note: minor hero "${(mg.words[0] || {}).text}" (${Math.round(bb.w)}px) spills its ${Math.round(pwPx)}px column — fine on a clear side; reduce size if it crosses the subject`,
          );
      }
      try {
        fs.unlinkSync(path.join(project, "_layout.json"));
      } catch {}
    }
    if (minorChanged) {
      fs.writeFileSync(path.join(project, "plan.json"), JSON.stringify(plan, null, 2));
      cp2.spawnSync("node", [path.join(__dirname, "make-composition.cjs"), project], {
        stdio: "ignore",
      });
    }
  }
  process.exit(0);
}
main();
