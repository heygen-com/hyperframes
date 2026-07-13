#!/usr/bin/env node
// contrast-report.mjs — HyperFrames contrast audit
//
// Reads a composition, seeks to N sample timestamps, walks the DOM for text
// elements, measures the WCAG 2.1 contrast ratio between each element's
// declared foreground color and the ACTUAL pixels behind it, and emits:
//
//   - contrast-report.json  (machine-readable, one entry per text element × sample)
//   - contrast-overlay.png  (sprite grid; magenta=fail AA, yellow=pass AA only, green=AAA)
//
// Usage:
//   node skills/hyperframes-creative/scripts/contrast-report.mjs <composition-dir> \
//     [--samples N] [--out <dir>] [--width W] [--height H] [--fps N]
//
// Env:
//   HYPERFRAMES_SKILL_PKG_VERSION — pin the @hyperframes/producer version used
//     when bootstrapping (global skill installs cannot infer it; falls back to
//     @latest with a warning otherwise).
//
// The composition directory must contain an index.html. Raw authoring HTML
// works — the producer's file server auto-injects the runtime at serve time.
// Exits 1 if any text element fails WCAG AA.
//
// Background sampling: each sample time is captured TWICE — once via the
// producer's normal (video-accurate) captureFrameToBuffer for the overlay
// image, and once via a plain page.screenshot() taken right after hiding
// every candidate element's own text paint (color/fill → transparent,
// layout-neutral). The second capture reveals the REAL composited pixels
// that were directly behind the glyphs, which this script then samples
// straight from each element's own bbox — no proximity heuristic needed.
// This is deliberately NOT routed through captureFrameToBuffer: that
// pipeline has a static-frame dedup cache keyed by frame index/time that
// knows nothing about our DOM mutation and would happily hand back a
// cached pre-mutation buffer. A direct page.screenshot() bypasses that
// entirely and is the same technique validated in
// packages/cli/src/commands/contrast-audit.browser.js.
//
// The previous approach sampled a 4px ring just OUTSIDE the bbox, which
// breaks down whenever what's immediately outside the text differs from
// what's actually behind it: a neighboring panel/component just past the
// text's edge, a backdrop-filter-blurred glass panel sized only a couple
// pixels larger than the text, or a translucent decoration that only
// partially overlaps the ring (or sits entirely inside the bbox, never
// touching the ring at all).

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { hyperframesPackageSpec, importPackagesOrBootstrap } from "./package-loader.mjs";

// Use the producer's file server — it auto-injects the HyperFrames runtime
// and render-seek bridge, so raw authoring HTML works without a build step.
const packages = await importPackagesOrBootstrap(["@hyperframes/producer", "sharp"], {
  npmPackages: [hyperframesPackageSpec("@hyperframes/producer"), "sharp@0.34.5"],
});
const sharp = packages.sharp.default;
const {
  createFileServer,
  createCaptureSession,
  initializeSession,
  closeCaptureSession,
  captureFrameToBuffer,
  getCompositionDuration,
} = packages["@hyperframes/producer"];

// ─── CLI ─────────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));
if (!args.composition) die("missing <composition-dir>");

const SAMPLES = Number(args.samples ?? 10);
const OUT_DIR = resolve(args.out ?? ".hyperframes/contrast");
const WIDTH = Number(args.width ?? 1920);
const HEIGHT = Number(args.height ?? 1080);
const FPS = Number(args.fps ?? 30);
const COMP_DIR = resolve(args.composition);

// ─── Main ────────────────────────────────────────────────────────────────────

await mkdir(OUT_DIR, { recursive: true });

const server = await createFileServer({ projectDir: COMP_DIR, port: 0 });
const session = await createCaptureSession(
  server.url,
  OUT_DIR,
  { width: WIDTH, height: HEIGHT, fps: FPS, format: "png" },
  null,
);
await initializeSession(session);

try {
  const duration = await getCompositionDuration(session);
  const times = Array.from(
    { length: SAMPLES },
    (_, i) => +(((i + 0.5) / SAMPLES) * duration).toFixed(3),
  );

  const allEntries = [];
  const overlayFrames = [];

  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    // Visible frame — used only for the human-facing overlay image.
    const { buffer: pngBuf } = await captureFrameToBuffer(session, i, t);

    // Hides each candidate's own text paint and returns its selector/fg/bbox.
    const candidates = await prepareTextElements(session);
    let elements;
    try {
      // Deliberately session.page.screenshot(), not captureFrameToBuffer —
      // see the header comment for why.
      const hiddenB64 = await session.page.screenshot({ encoding: "base64", type: "png" });
      elements = await measureAgainstHiddenTextFrame(hiddenB64, candidates);
    } finally {
      await restoreTextElements(session);
    }

    const annotated = await annotateFrame(pngBuf, elements);
    overlayFrames.push({ t, png: annotated });
    for (const el of elements) allEntries.push({ time: t, ...el });
  }

  const report = {
    composition: COMP_DIR,
    width: WIDTH,
    height: HEIGHT,
    duration,
    samples: times,
    entries: allEntries,
    summary: summarize(allEntries),
  };

  await writeFile(resolve(OUT_DIR, "contrast-report.json"), JSON.stringify(report, null, 2));
  await writeOverlaySprite(overlayFrames, resolve(OUT_DIR, "contrast-overlay.png"));

  printSummary(report);
  process.exitCode = report.summary.failAA > 0 ? 1 : 0;
} finally {
  await closeCaptureSession(session).catch(() => {});
  server.close();
}

// ─── DOM probe + text-hide (runs in the page) ────────────────────────────────

// Walks the DOM for text-bearing elements, computes each one's foreground
// paint, and hides that element's own text (color/fill → transparent,
// !important, layout-neutral) so the caller's next screenshot reveals the
// real pixels behind the glyphs. Returns the candidate list; call
// restoreTextElements() afterward (in a finally) to undo the hide.
async function prepareTextElements(session) {
  return await session.page.evaluate(() => {
    /** @type {Array<{selector: string, text: string, fg: [number,number,number,number], fontSize: number, fontWeight: number, bbox: {x:number,y:number,w:number,h:number}}>} */
    const out = [];
    const restores = [];
    // Registered BEFORE the walk starts and pushed to incrementally as each
    // element is hidden: if something in the walk throws partway through,
    // everything hidden so far is still reachable for restore instead of
    // leaking hidden indefinitely.
    window.__contrastReportRestores = restores;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    const parseColor = (c) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return [0, 0, 0, 1];
      const parts = m[1].split(",").map((s) => parseFloat(s.trim()));
      return [parts[0], parts[1], parts[2], parts[3] ?? 1];
    };
    // Like parseColor, but returns null instead of defaulting to black when
    // the value isn't a solid rgb()/rgba() color — e.g. SVG paint keywords
    // such as "none"/"context-fill", or a gradient/pattern reference like
    // 'url("#grad")'. Callers should fall back to another source of truth
    // rather than trust a fabricated black.
    const tryParseSolidColor = (c) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const parts = m[1].split(",").map((s) => parseFloat(s.trim()));
      if (parts.some((v) => Number.isNaN(v))) return null;
      return [parts[0], parts[1], parts[2], parts[3] ?? 1];
    };
    // SVG text (<text>, <tspan>, <textPath>) is painted via the `fill`
    // property, not `color` — the two are independent CSS properties in
    // SVG. A page can set `fill` without ever touching `color`, in which
    // case getComputedStyle(el).color resolves to the inherited/initial
    // value (often black) and does not reflect what's actually rendered.
    const isSvgTextElement = (el) => !!el.ownerSVGElement;
    const selectorOf = (el) => {
      if (el.id) return `#${el.id}`;
      const cls = [...el.classList].slice(0, 2).join(".");
      return cls ? `${el.tagName.toLowerCase()}.${cls}` : el.tagName.toLowerCase();
    };
    let el;
    while ((el = walker.nextNode())) {
      // must have direct text
      const direct = [...el.childNodes].some(
        (n) => n.nodeType === 3 && n.textContent.trim().length,
      );
      if (!direct) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      if (parseFloat(cs.opacity) <= 0.01) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) continue;
      const isSvgText = isSvgTextElement(el);
      const fg = isSvgText
        ? tryParseSolidColor(cs.fill) || parseColor(cs.color)
        : parseColor(cs.color);
      if (fg[3] <= 0.01) continue;
      const strokeWidth = parseFloat(cs.webkitTextStrokeWidth || "0");
      const stroke = strokeWidth > 0 ? tryParseSolidColor(cs.webkitTextStrokeColor || "") : null;

      // A `transition` on color/fill would otherwise animate this hide
      // instead of applying it instantly — the screenshot taken right after
      // can catch a partially-transparent glyph mid-transition instead of a
      // fully hidden one, contaminating the background sample. Force
      // `transition: none` alongside color/fill so the hide is atomic.
      const origTransition = el.style.getPropertyValue("transition");
      const origTransitionPriority = el.style.getPropertyPriority("transition");
      el.style.setProperty("transition", "none", "important");
      const origColor = el.style.getPropertyValue("color");
      const origColorPriority = el.style.getPropertyPriority("color");
      el.style.setProperty("color", "transparent", "important");
      let origFill = null;
      let origFillPriority = null;
      if (isSvgText) {
        origFill = el.style.getPropertyValue("fill");
        origFillPriority = el.style.getPropertyPriority("fill");
        el.style.setProperty("fill", "transparent", "important");
      }
      let origStrokeColor = null;
      let origStrokeColorPriority = null;
      if (stroke && stroke[3] > 0.01) {
        origStrokeColor = el.style.getPropertyValue("-webkit-text-stroke-color");
        origStrokeColorPriority = el.style.getPropertyPriority("-webkit-text-stroke-color");
        el.style.setProperty("-webkit-text-stroke-color", "transparent", "important");
      }
      restores.push({
        el,
        origTransition,
        origTransitionPriority,
        origColor,
        origColorPriority,
        origFill,
        origFillPriority,
        origStrokeColor,
        origStrokeColorPriority,
        hasStroke: !!stroke && stroke[3] > 0.01,
        isSvgText,
      });

      out.push({
        selector: selectorOf(el),
        text: el.textContent.trim().slice(0, 60),
        fg,
        stroke: stroke && stroke[3] > 0.01 ? stroke : null,
        fontSize: parseFloat(cs.fontSize),
        fontWeight: Number(cs.fontWeight) || 400,
        bbox: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
      });
    }
    return out;
  });
}

async function restoreTextElements(session) {
  await session.page.evaluate(() => {
    const restores = window.__contrastReportRestores;
    if (!restores) return;
    for (const r of restores) {
      if (r.origColor) r.el.style.setProperty("color", r.origColor, r.origColorPriority);
      else r.el.style.removeProperty("color");
      if (r.isSvgText) {
        if (r.origFill) r.el.style.setProperty("fill", r.origFill, r.origFillPriority);
        else r.el.style.removeProperty("fill");
      }
      if (r.hasStroke) {
        if (r.origStrokeColor) {
          r.el.style.setProperty(
            "-webkit-text-stroke-color",
            r.origStrokeColor,
            r.origStrokeColorPriority,
          );
        } else r.el.style.removeProperty("-webkit-text-stroke-color");
      }
      if (r.origTransition) {
        r.el.style.setProperty("transition", r.origTransition, r.origTransitionPriority);
      } else r.el.style.removeProperty("transition");
    }
    window.__contrastReportRestores = null;
  });
}

// ─── Pixel sampling + WCAG math ──────────────────────────────────────────────

// Samples the REAL composited background directly inside each candidate's
// own bbox, from a screenshot taken with every candidate's text hidden —
// robust to panel edges, backdrop-filter blur, and translucent decoration
// in ways a proximity-based ring outside the bbox isn't. Mirrors
// packages/cli/src/commands/contrast-sample.ts's computeSampleRect /
// sampleGridPoints (kept in sync, not imported — this script bootstraps
// npm-published packages and can't reach into the cli package's sources).
async function measureAgainstHiddenTextFrame(hiddenImgBase64, candidates) {
  const raw = Buffer.from(hiddenImgBase64, "base64");
  const img = sharp(raw);
  const { width, height } = await img.metadata();
  const pixels = await img.ensureAlpha().raw().toBuffer();
  const channels = 4;

  const measured = [];
  for (const c of candidates) {
    const bg = sampleBboxMedian(pixels, width, height, channels, c.bbox);
    if (!bg) continue;
    let fg = compositeOver(c.fg, bg); // flatten any alpha against measured bg
    let ratio = wcagRatio(fg, bg);
    if (c.stroke) {
      const stroke = compositeOver(c.stroke, bg);
      const strokeRatio = wcagRatio(stroke, bg);
      if (strokeRatio > ratio) {
        fg = stroke;
        ratio = strokeRatio;
      }
    }
    const large = isLargeText(c.fontSize, c.fontWeight);
    measured.push({
      selector: c.selector,
      text: c.text,
      fg,
      fontSize: c.fontSize,
      fontWeight: c.fontWeight,
      bbox: c.bbox,
      bg,
      ratio: +ratio.toFixed(2),
      wcagAA: large ? ratio >= 3 : ratio >= 4.5,
      wcagAALarge: ratio >= 3,
      wcagAAA: large ? ratio >= 4.5 : ratio >= 7,
    });
  }
  return measured;
}

async function annotateFrame(pngBuf, elements) {
  const { width, height } = await sharp(pngBuf).metadata();
  // Draw boxes + ratio labels as an SVG overlay (sharp composite).
  const svg = buildOverlaySVG(elements, width, height);
  return await sharp(pngBuf)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
}

function sampleBboxMedian(raw, width, height, channels, bbox) {
  // Sample the element's OWN box (glyphs are hidden in this frame), inset
  // 1px on each side to dodge anti-aliased edge pixels, clamped to the
  // frame bounds. A bounded grid, not a full scan, so a wide caption bar
  // doesn't turn into thousands of samples.
  const x0 = Math.max(0, Math.round(bbox.x) + 1);
  const x1 = Math.min(width - 1, Math.round(bbox.x + bbox.w) - 1);
  const y0 = Math.max(0, Math.round(bbox.y) + 1);
  const y1 = Math.min(height - 1, Math.round(bbox.y + bbox.h) - 1);
  if (x1 <= x0 || y1 <= y0) return null;

  const stepX = Math.max(1, Math.floor((x1 - x0) / 12));
  const stepY = Math.max(1, Math.floor((y1 - y0) / 6));
  const r = [],
    g = [],
    b = [];
  for (let y = y0; y <= y1; y += stepY) {
    for (let x = x0; x <= x1; x += stepX) {
      const i = (y * width + x) * channels;
      r.push(raw[i]);
      g.push(raw[i + 1]);
      b.push(raw[i + 2]);
    }
  }
  if (r.length === 0) return null;
  return [median(r), median(g), median(b), 1];
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function compositeOver([fr, fg, fb, fa], [br, bg, bb]) {
  return [
    Math.round(fr * fa + br * (1 - fa)),
    Math.round(fg * fa + bg * (1 - fa)),
    Math.round(fb * fa + bb * (1 - fa)),
    1,
  ];
}

function relLum([r, g, b]) {
  const ch = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

function wcagRatio(a, b) {
  const la = relLum(a);
  const lb = relLum(b);
  const [L1, L2] = la > lb ? [la, lb] : [lb, la];
  return (L1 + 0.05) / (L2 + 0.05);
}

function isLargeText(fontSize, fontWeight) {
  return fontSize >= 24 || (fontSize >= 19 && fontWeight >= 700);
}

// ─── Overlay rendering ───────────────────────────────────────────────────────

function buildOverlaySVG(elements, w, h) {
  const rects = elements
    .map((el) => {
      const color = !el.wcagAA ? "#ff00aa" : !el.wcagAAA ? "#ffcc00" : "#00e08a";
      const { x, y, w: bw, h: bh } = el.bbox;
      return `
        <rect x="${x}" y="${y}" width="${bw}" height="${bh}"
              fill="none" stroke="${color}" stroke-width="3"/>
        <rect x="${x}" y="${y - 18}" width="${48}" height="16" fill="${color}"/>
        <text x="${x + 4}" y="${y - 5}" font-family="monospace" font-size="12" fill="#000">
          ${el.ratio.toFixed(1)}:1
        </text>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${rects}</svg>`;
}

async function writeOverlaySprite(frames, outPath) {
  if (!frames.length) return;
  const cols = Math.min(frames.length, 5);
  const rows = Math.ceil(frames.length / cols);
  const { width, height } = await sharp(frames[0].png).metadata();
  const scale = 0.25;
  const cellW = Math.round(width * scale);
  const cellH = Math.round(height * scale);

  const cells = await Promise.all(
    frames.map(async (f) => ({
      input: await sharp(f.png).resize(cellW, cellH).png().toBuffer(),
      time: f.t,
    })),
  );

  const composites = cells.map((c, i) => ({
    input: c.input,
    top: Math.floor(i / cols) * cellH,
    left: (i % cols) * cellW,
  }));

  await sharp({
    create: {
      width: cols * cellW,
      height: rows * cellH,
      channels: 3,
      background: { r: 16, g: 16, b: 20 },
    },
  })
    .composite(composites)
    .png()
    .toFile(outPath);
}

// ─── Summary ────────────────────────────────────────────────────────────────

function summarize(entries) {
  const total = entries.length;
  const failAA = entries.filter((e) => !e.wcagAA).length;
  const passAAonly = entries.filter((e) => e.wcagAA && !e.wcagAAA).length;
  const passAAA = entries.filter((e) => e.wcagAAA).length;
  return { total, failAA, passAAonly, passAAA };
}

function printSummary({ summary, entries }) {
  const { total, failAA, passAAonly, passAAA } = summary;
  console.log(`\nContrast report: ${total} text-element samples`);
  console.log(`  fail WCAG AA:     ${failAA}`);
  console.log(`  pass AA, not AAA: ${passAAonly}`);
  console.log(`  pass AAA:         ${passAAA}`);
  if (failAA) {
    console.log("\nFailures:");
    for (const e of entries.filter((x) => !x.wcagAA)) {
      console.log(`  t=${e.time}s  ${e.selector.padEnd(24)}  ${e.ratio.toFixed(2)}:1  "${e.text}"`);
    }
  }
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {};
  let positional = 0;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1]?.startsWith("--") ? true : argv[++i];
      out[k] = v;
    } else if (positional === 0) {
      out.composition = a;
      positional++;
    }
  }
  return out;
}

function die(msg) {
  console.error(`contrast-report: ${msg}`);
  process.exit(2);
}
