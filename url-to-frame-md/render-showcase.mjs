#!/usr/bin/env node
// render-showcase.mjs — frame.md → frame-showcase.html, screenshotted to PNG via headless Chrome.
//   node render-showcase.mjs --frame ./stripe-capture/frame.md [--out <dir>] [--chrome <path>]

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { hexToRgb, isHex, lumOf } from "./lib/color.mjs";

const statSafe = (p) => {
  try {
    return statSync(p);
  } catch {
    return null;
  }
};
const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d;
};
// desktop Chrome runs sandboxed by default; pass --no-sandbox for container/root (where Chrome
// otherwise refuses to launch), or set HF_CHROME_NO_SANDBOX=1.
const noSandbox = argv.includes("--no-sandbox") || process.env.HF_CHROME_NO_SANDBOX === "1";

// Demo A-roll avatar + b-roll hero. Default: hosted URLs (Chrome fetches at render, like the fonts).
// Override with --avatar / --hero <url|path>: URL → used directly; local path → inlined as data-URI.
const DEFAULT_AVATAR_URL = "https://www.heygenverse.com/s/f3a3205d-ad9d-4c2f-a97b-c8bf0d557925/raw";
const DEFAULT_HERO_URL = "https://www.heygenverse.com/s/9d1617d6-9c4d-4ac5-87ea-67c16c0d3920/raw";
const assetSrc = (v) => {
  if (!v) return null;
  if (/^https?:\/\//.test(v)) return v;
  try {
    return "data:image/jpeg;base64," + readFileSync(resolve(v)).toString("base64");
  } catch {
    return null;
  }
};
const avatarAsset = assetSrc(flag("avatar", DEFAULT_AVATAR_URL));
const heroAsset = assetSrc(flag("hero", DEFAULT_HERO_URL));
const die = (m) => {
  console.error(`✗ render-showcase: ${m}`);
  process.exit(1);
};

const framePath = resolve(flag("frame", "frame.md"));
if (!existsSync(framePath)) die(`no frame.md at ${framePath}`);
const baseDir = dirname(framePath);
const outDir = resolve(flag("out", baseDir));
const md = readFileSync(framePath, "utf8");
const CHROME = flag(
  "chrome",
  [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ].find((p) => existsSync(p)),
);

// ── parse frame.md ─────────────────────────────────────────────────────────────
const fm = (/^---\n([\s\S]*?)\n---/.exec(md) ?? [undefined, ""])[1];
const frameWidth = parseInt((/unit:.*?(\d{3,4})\s*[×x]/.exec(md) ?? [undefined, "1920"])[1], 10);
// The showcase never prints the source site's name — the captured URL is only the aesthetic source,
// and every frame is a UNIVERSAL, content-agnostic template. The gallery card outside does the naming.
const wmCqw = 9;

const blockLines = (name) => {
  const out = [];
  let inB = false;
  for (const line of fm.split(/\r?\n/)) {
    if (new RegExp(`^${name}:\\s*$`).test(line)) {
      inB = true;
      continue;
    }
    if (!inB) continue;
    if (/^\S/.test(line)) break;
    out.push(line);
  }
  return out;
};
const kvBlock = (name) => {
  const o = {};
  for (const line of blockLines(name)) {
    const m = line.match(/^\s+([\w-]+):\s*"([^"]+)"/);
    if (m) o[m[1]] = m[2];
  }
  return o;
};

const colors = kvBlock("colors");
// grounds: the ranked page grounds emitted by the generator — a list of `- { bg, on, kind }`.
// Data-driven, incl. dark/tinted grounds the flat `colors` roles can't hold. Empty for older frame.md.
const groundsParsed = [];
for (const line of blockLines("grounds")) {
  const bg = line.match(/bg:\s*"([^"]+)"/);
  const on = line.match(/on:\s*"([^"]+)"/);
  const kind = line.match(/kind:\s*"([^"]+)"/);
  if (bg) groundsParsed.push({ bg: bg[1], on: on?.[1], kind: kind?.[1] ?? "surface" });
}
const radii = kvBlock("radii");
const spacing = kvBlock("spacing");
const shadows = kvBlock("shadows");
const gradients = kvBlock("gradients");
const gradientList = Object.values(gradients);
// chroma = max stop saturation (max−min RGB channel) — a real color wash scores high, a
// neutral scrim (white/cream → transparent) scores low. Pick the most chromatic as the hero ground.
const chromaOf = (grad) => {
  let max = 0;
  for (const m of String(grad).matchAll(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/g)) {
    const [r, g, b] = [+m[1], +m[2], +m[3]];
    max = Math.max(max, Math.max(r, g, b) - Math.min(r, g, b));
  }
  return max;
};
const heroGradient =
  gradientList
    .map((g) => [g, chromaOf(g)])
    .filter(([, c]) => c > 55)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
const resolveRefs = (s) =>
  String(s ?? "")
    .replace(/\{colors\.([\w-]+)\}/g, (_, k) => colors[k] ?? "currentColor")
    .replace(/\{radii\.([\w-]+)\}/g, (_, k) => radii[k] ?? "0px");

// typography: role -> { fontFamily, cqw, px, weight, lineHeight, tracking, color }
const types = [];
for (const line of blockLines("typography")) {
  const m = line.match(/^\s+([\w-]+):\s*\{(.*)\}/);
  if (!m) continue;
  const body = m[2];
  const get = (k) => {
    const mm = body.match(new RegExp(`${k}:\\s*(?:"([^"]+)"|([\\d.\\-]+))`));
    return mm ? (mm[1] ?? mm[2]) : null;
  };
  const cqw = get("cqw");
  const pxv = get("px");
  types.push({
    role: m[1],
    fontFamily: get("fontFamily") || "sans-serif",
    cqw: cqw != null ? parseFloat(cqw) : null,
    px: cqw != null ? (parseFloat(cqw) * frameWidth) / 100 : pxv != null ? parseFloat(pxv) : 16,
    weight: get("weight") || "400",
    lineHeight: get("lineHeight") || "1.15",
    tracking: get("tracking"),
    color: get("color") || "ink",
  });
}
const typeByRole = new Map(types.map((t) => [t.role, t]));
const cqwOf = (role, fb) => typeByRole.get(role)?.cqw ?? fb;

// components: name -> { prop: value }
const components = [];
{
  let cur = null;
  for (const line of blockLines("components")) {
    const head = line.match(/^\s{2}([\w-]+):\s*$/);
    const prop = line.match(/^\s{4}([\w-]+):\s*"([^"]+)"/);
    if (head) {
      cur = { name: head[1], props: {} };
      components.push(cur);
    } else if (prop && cur) {
      cur.props[prop[1]] = prop[2];
    }
  }
}
const fontFace =
  (/```html\s*\n(<style>[\s\S]*?<\/style>)\s*\n```/.exec(md) ?? [undefined, ""])[1] || "";
if (!Object.keys(colors).length) die("no colors parsed from frame.md");

// ── brand atoms ─────────────────────────────────────────────────────────────────
const canvas = colors.canvas ?? colors.bg ?? "#FFFFFF";
const ink = colors.ink ?? colors.text ?? "#111111";
const inkMuted = colors["ink-muted"] ?? colors.muted ?? ink;
const accent = colors.accent ?? colors.primary ?? "#000000";
// full vivid accent set (primary + secondaries); frames rotate through it. accents2 = secondaries only.
const accents2 = [colors["accent-2"], colors["accent-3"]].filter(isHex);
const accents = [accent, ...accents2].filter(isHex);
const acc = (i) => accents[i % accents.length] ?? accent;
// a brand spectrum wash across the vivid hues — only meaningful when there are ≥2 (else null).
const brandWash = accents.length >= 2 ? `linear-gradient(120deg, ${accents.join(", ")})` : null;
const dispFont =
  types.find((t) => t.role.includes("head") || t.role.includes("display"))?.fontFamily ??
  "sans-serif";
const bodyFont = types.find((t) => t.role.includes("body"))?.fontFamily ?? dispFont;
const cssVars = Object.entries(colors)
  .map(([k, v]) => `--${k}: ${v};`)
  .join(" ");
const r1 = radii.r1 ?? "8px";

// gallery ground derived from the brand canvas (light brand → light board, dark → dark).
const shade = (hex, f) => {
  if (!isHex(hex)) return hex;
  const [r, g, b] = hexToRgb(hex);
  const c = (x) =>
    Math.round(Math.max(0, Math.min(255, x)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r + 255 * f)}${c(g + 255 * f)}${c(b + 255 * f)}`;
};
const darkGallery = (lumOf(canvas) ?? 255) < 128;
const galleryBg = darkGallery ? "#0e0e0e" : shade(canvas, -0.08); // light: a touch darker than the frames so they read as lit panels
const docInk = darkGallery ? "#ededed" : "#1b1b1b";
const docFaint = darkGallery ? "#7c7c7c" : "#8a8a8a";
const secBorder = darkGallery ? "#232323" : "rgba(0,0,0,.12)";
const railName = darkGallery ? "#eaeaea" : "#1b1b1b";
const railAttr = darkGallery ? "#7c7c7c" : "#8a8a8a";
const chipHair = darkGallery ? "rgba(255,255,255,.14)" : "rgba(0,0,0,.14)";
const frameShadow = darkGallery ? "0 10px 40px rgba(0,0,0,.45)" : "0 10px 34px rgba(0,0,0,.14)";
const parseTypo = (s) => {
  const m = /^(.*?)\s+(\d{3})$/.exec(String(s || ""));
  return m ? { fam: m[1], weight: m[2] } : { fam: s || bodyFont, weight: "400" };
};

// component → CSS class body (resolved)
const compCss = components
  .map((c) => {
    const p = c.props;
    const t = parseTypo(p.typography);
    const isCard = /^card/.test(c.name);
    const hasShadow = p.shadow && p.shadow !== "none";
    const decls = [
      // a gradient fill (e.g. Snowflake's blue pill CTA) wins over the flat color when present
      p.backgroundImage
        ? `background:${resolveRefs(p.backgroundImage)}`
        : p.backgroundColor && `background:${resolveRefs(p.backgroundColor)}`,
      p.textColor && `color:${resolveRefs(p.textColor)}`,
      `font-family:'${t.fam}',sans-serif`,
      `font-weight:${t.weight}`,
      p.fontSize && `font-size:${p.fontSize}`, // frame-scale variants carry a cqw size
      (p.rounded || p.borderRadius) && `border-radius:${resolveRefs(p.rounded ?? p.borderRadius)}`,
      p.padding && `padding:${p.padding}`,
      p.border && `border:${resolveRefs(p.border)}`,
      p.height && `min-height:${p.height}`,
      p.backdropFilter && `backdrop-filter:${p.backdropFilter}`,
      p.backdropFilter && `-webkit-backdrop-filter:${p.backdropFilter}`,
      hasShadow && `box-shadow:${resolveRefs(p.shadow)}`,
      // showcase legibility only (spec unchanged): a card with no captured border/shadow gets a faint
      // hairline so dark-on-dark / white-on-white surfaces read as surfaces, like the swatch chips.
      isCard && !hasShadow && !p.border && `box-shadow: inset 0 0 0 1px ${chipHair}`,
    ].filter(Boolean);
    return `  .c-${c.name}{ ${decls.join("; ")}; display:inline-flex; align-items:center; justify-content:center; box-sizing:border-box }`;
  })
  .join("\n");

// ── composed 16:9 frames (compose the tokens) ─────────────────────────────────
const heroCqw = cqwOf("display-hero", 8);
const eyebrowCqw = Math.max(cqwOf("label", 0.73) * 1.2, 1.2);
const btnPrimary = components.find((c) => c.name === "button-primary");

const frame = (cls, inner) => `<div class="frame ${cls}"><div class="fill">${inner}</div></div>`;
const cell = (cls, inner, name, arch, density) =>
  `<div class="cell">${frame(cls, inner)}<div class="rail"><span class="rn">${name}</span><span class="ra">${arch} · ${density}</span></div></div>`;

const eyebrow = (txt) => `<div class="eyebrow">${txt}</div>`;
const counter = (txt) => `<div class="counter">${txt}</div>`;

// 1 · identity / cover
const coverInner = `
  <div class="aline"></div>
  ${eyebrow("FRAME SYSTEM · VOL.01")}
  <div class="wordmark">Design, distilled.</div>
  <div class="coversub">Generated frame system — atoms are sacred, composition is free.</div>
  ${counter("01 / 04")}
  <div class="pbar"></div>`;
// focal-artifact frame: gradient ground + floating card/glass panel + frame-scale CTA.
const hasGlass = components.some((c) => c.name === "glass-panel");
const hasGiant = components.some((c) => c.name === "button-primary-giant");
const hasCard = components.some((c) => /^card/.test(c.name));
// focal ground: captured wash if any; else a restrained accent glow only if the brand uses glass; else a flat brand ground.
const coloredGround = !!heroGradient || hasGlass;
const focalGround = heroGradient
  ? heroGradient
  : hasGlass
    ? // a restrained accent GLOW on the brand's own canvas (canvas stays dominant) — enough color for
      // the frost to read over, without a fabricated full-bleed aurora that misreads the brand
      `radial-gradient(90% 90% at 22% 16%, ${accent}, ${canvas} 55%)`
    : canvas;
// the floating panel: the frosted glass material if captured, else the elevated card
const panelClass = hasGlass ? "c-glass-panel" : hasCard ? "c-card" : "";
// panel fill: canvas-tinted frost on a colored ground (so it separates); the card's own surface on a flat ground.
const [pfr, pfg, pfb] = isHex(canvas) ? hexToRgb(canvas) : [255, 255, 255];
const panelBg = coloredGround ? `background:rgba(${pfr}, ${pfg}, ${pfb}, 0.74); ` : "";
const ctaGiant = hasGiant
  ? `<span class="c-button-primary-giant">Get started</span>`
  : btnPrimary
    ? `<span class="c-button-primary">Get started</span>`
    : "";
const plateInner = `
  ${eyebrow("FOCAL · MATERIAL ON GROUND")}
  <div class="platewrap">
    <div class="${panelClass} platepanel">
      <div class="cardk">The material, foregrounded</div>
      <div class="cardv">Built to be seen.</div>
      ${ctaGiant}
    </div>
  </div>`;

// grounds-driven frames: each commits to a captured ground, text auto-contrasts, meta/caption rails frame it.
const lumSafe = (h) => lumOf(h) ?? 128;
const onColorFor = (g) => {
  const cands = [ink, canvas, "#FFFFFF", "#0E0E0E"].filter(isHex);
  return cands.map((c) => [c, Math.abs(lumSafe(c) - lumSafe(g))]).sort((a, b) => b[1] - a[1])[0][0];
};
const emphasisOn = (g) => (Math.abs(lumSafe(accent) - lumSafe(g)) > 45 ? accent : onColorFor(g));
// grounds to rotate through: the generator's ranked grounds, then accent + ink; falls back to role-guess.
const groundList = [];
{
  const seen = new Set();
  const push = (label, bg, on) => {
    if (bg && isHex(bg) && !seen.has(bg.toUpperCase())) {
      seen.add(bg.toUpperCase());
      groundList.push([label, bg, on && isHex(on) ? on : onColorFor(bg)]);
    }
  };
  for (const gr of groundsParsed) push(gr.kind ?? "ground", gr.bg, gr.on);
  push("accent", colors.accent);
  push("ink", colors.ink);
  if (!groundList.length)
    for (const key of ["canvas", "accent", "ink", "surface", "accent-2"]) push(key, colors[key]);
}
const g = (i) => groundList[i % groundList.length] ?? ["canvas", canvas, onColorFor(canvas)];
// a motion beat: one centered focal on a committed ground. ground = [label, bg, on] tuple.
const cxFrame = (cls, ground, mainFn) => {
  const bg = ground[1];
  const on = ground[2] ?? onColorFor(bg);
  const emph = emphasisOn(bg);
  return `<div class="frame cx ${cls}" style="background:${bg}; color:${on}">
    <div class="cx-tex"></div>
    <div class="cx-main">${mainFn(on, emph)}</div>
  </div>`;
};
// asset frames — two patterns: ELEMENT (circular-masked hero + accent ring) and BACKGROUND (full-bleed + scrim).
const assetElFrame = (ground) => {
  const bg = ground[1];
  const on = ground[2] ?? onColorFor(bg);
  const emph = emphasisOn(bg);
  if (!heroAsset) return cxFrame("cx-cl", ground, aClaim); // graceful fallback: a drawn beat
  return `<div class="frame cx cx-asset" style="background:${bg}; color:${on}">
    <div class="cx-tex"></div>
    <div class="cx-ael">
      <div class="cx-aet">
        <div class="cx-eye" style="color:${emph}">FEATURE · IN FOCUS</div>
        <div class="cx-aeh">The <em style="color:${emph}">one</em> that matters.</div>
        <div class="cx-abadges">
          <span class="cx-badge" style="border-color:${emph}55">${ICON.bolt}Fast</span>
          <span class="cx-badge" style="border-color:${emph}55">${ICON.check}Ready</span>
        </div>
      </div>
      <div class="cx-aeimg">
        <div class="cx-orbit" style="border-color:${emph}55"></div>
        <div class="cx-circ" style="border-color:${emph}"><img src="${heroAsset}" alt=""></div>
      </div>
    </div>
  </div>`;
};
const assetBgFrame = (ground) => {
  const emph = emphasisOn(ground[1]);
  if (!heroAsset) return cxFrame("cx-st", ground, aStat); // graceful fallback: a drawn beat
  const [er, eg, eb] = isHex(emph) ? hexToRgb(emph) : [0, 0, 0];
  // darken-for-legibility + a low-alpha brand-accent wash → cinematic, brand-tinted, always readable.
  const scrim = `linear-gradient(0deg, rgba(8,8,10,.74), rgba(8,8,10,.32)), linear-gradient(0deg, rgba(${er},${eg},${eb},.30), rgba(${er},${eg},${eb},.05))`;
  return `<div class="frame cx cx-assetbg" style="color:#fff">
    <img class="cx-bgimg" src="${heroAsset}" alt="">
    <div class="cx-scrim" style="background:${scrim}"></div>
    <div class="cx-main cx-bgmain">
      <div class="cx-eye" style="color:${emph}">IN FRAME</div>
      <div class="cx-word">Set the scene.</div>
      <div class="cx-sub" style="opacity:.85">Asset as ground · type on the scrim.</div>
    </div>
  </div>`;
};
const cxCell = (fr, name, arch) =>
  `<div class="cell">${fr}<div class="rail"><span class="rn">${name}</span><span class="ra">${arch}</span></div></div>`;
const aCover = (on, emph) =>
  `<div class="cx-eye" style="color:${emph}">FRAME SYSTEM · VOL.01</div><div class="cx-word">Design,<br>distilled.</div><div class="cx-sub">Atoms are sacred · composition is free.</div>`;
const aClaim = (on, emph) =>
  `<div class="cx-eye" style="color:${emph}">THE CLAIM</div><div class="cx-claim">One bold idea, <em style="color:${emph}">said once</em>, owns the frame.</div>`;
// no data figures — a graphic "focus" beat: a single drawn target on the ground + a universal line.
const aStat = (on, emph) =>
  `<div class="cx-eye" style="color:${emph}">IN FOCUS</div><div class="cx-focus" style="color:${emph}">${ICON.target}</div><div class="cx-claim">Make <em style="color:${emph}">one thing</em> unmissable.</div>`;

// cover/claim/stat beats in the video-agent idiom (tri-tone ground, mono kicker, footer meta, avatar A-roll).
const cx2Foot = (on) =>
  `<div class="cx2-ft" style="border-color:${on}33"><span>Frame System</span><span>Vol.01 · 2026</span></div>`;
// A-roll = full-frame talking-head avatar + a transparent overlay; accent-tinted scrim keeps overlay text legible.
const arScrim = (acc) => {
  const [r, g, b] = isHex(acc) ? hexToRgb(acc) : [0, 0, 0];
  return `linear-gradient(90deg, rgba(12,14,17,.52) 0%, rgba(12,14,17,.18) 46%, rgba(12,14,17,.02) 70%), linear-gradient(0deg, rgba(${r},${g},${b},.16), rgba(${r},${g},${b},.02))`;
};
const coverFrame = (ground) => {
  if (!avatarAsset) return claimFrame(ground);
  // overlay stays in corners/edges — face clear. NO site name (the URL is only the aesthetic source);
  // a neutral editorial title stands in, like a real video-agent topic card.
  return `<div class="frame cx2 cx2-aroll" style="color:#fff">
    <img class="cx2-arimg" src="${avatarAsset}" alt="">
    <div class="cx2-arscrim" style="background:${arScrim(accent)}"></div>
    <div class="cx2-arpill">Special Report</div>
    <div class="cx2-arlower">
      <div class="cx2-areye">Frame System · A-roll</div>
      <div class="cx2-artitle">The brief.</div>
      <span class="cx2-arrule" style="background:${accent}"></span>
    </div>
    <div class="cx2-arstamp">2026</div>
  </div>`;
};
const claimFrame = (ground) => {
  const bg = ground[1],
    on = ground[2] ?? onColorFor(bg),
    emph = emphasisOn(bg);
  return `<div class="frame cx2 cx2-claim" style="background:${bg};color:${on}">
    <div class="cx2-tex"></div>
    <div class="cx2-kick" style="color:${emph}">The Claim</div>
    <div class="cx2-claim-main"><span class="cx2-bigline">One bold idea,</span><span class="cx2-serif-lg" style="color:${emph}">said once,</span><span class="cx2-bigline">owns the frame.</span></div>
    ${cx2Foot(on)}
  </div>`;
};
// A-roll + a lower-third whose box IS the container (content padded inside); translucent fill keeps text opaque.
const statFrame = (ground) => {
  if (!avatarAsset) return claimFrame(ground);
  const on = onColorFor(canvas);
  const [cr, cg, cb] = isHex(canvas) ? hexToRgb(canvas) : [255, 255, 255];
  const bars = Array.from({ length: 34 }, (_, i) => {
    const h = (
      1 +
      (Math.abs(Math.sin(i * 0.7)) * 0.5 + Math.abs(Math.sin(i * 1.9)) * 0.5) * 2.4
    ).toFixed(2);
    return `<span class="cx2-fgbar" style="height:${h}cqw;background:${accent}"></span>`;
  }).join("");
  return `<div class="frame cx2 cx2-aroll">
    <img class="cx2-arimg" src="${avatarAsset}" alt="">
    <div class="cx2-fgcard" style="background:rgba(${cr},${cg},${cb},.93);color:${on}">
      <div class="cx2-lt-pill" style="border-color:${on}">Live Audio Feed</div>
      <div class="cx2-lt-eye">The Signal</div>
      <div class="cx2-lt-head">Forward Guidance</div>
      <div class="cx2-lt-wave">${bars}</div>
    </div>
  </div>`;
};
// radial hub-spoke system map: central accent hub + ring nodes + SVG connectors, neutral universal labels.
const networkFrame = (ground) => {
  const bg = ground[1],
    on = ground[2] ?? onColorFor(bg),
    emph = emphasisOn(bg);
  const labels = ["Signal", "System", "Reach", "Craft", "Scale", "Trust"];
  const N = labels.length,
    R = 40,
    cx = 50,
    cy = 50;
  const pos = labels.map((lab, i) => {
    const a = (i / N) * Math.PI * 2 - Math.PI / 2;
    return { lab, x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) };
  });
  const lines = pos
    .map(
      (p) =>
        `<line x1="${cx}" y1="${cy}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" stroke="${emph}" stroke-width=".5" stroke-opacity=".45"/>`,
    )
    .join("");
  // node dots rotate through the brand's vivid accent set — one color for a mono brand, the full
  // cyan/green/purple spread for a multi-accent brand like HeyGen, so the map carries the palette.
  const nodeEls = pos
    .map(
      (p, i) =>
        `<div class="cx3-node" style="left:${p.x.toFixed(1)}%;top:${p.y.toFixed(1)}%"><div class="cx3-ndot" style="border-color:${acc(i)};background:${bg}"><i style="background:${acc(i)}"></i></div><div class="cx3-nlab">${p.lab}</div></div>`,
    )
    .join("");
  return `<div class="frame cx2 cx3-net" style="background:${bg};color:${on}">
    <div class="cx2-tex"></div>
    <div class="cx3-head"><div class="cx3-title">System Map</div><div class="cx3-sub">How the parts connect</div></div>
    <div class="cx3-diagram">
      <svg class="cx3-svg" viewBox="0 0 100 100" preserveAspectRatio="none">${lines}</svg>
      ${nodeEls}
      <div class="cx3-hub" style="background:${emph};color:${onColorFor(emph)}">CORE</div>
    </div>
    <div class="cx3-legend"><span class="cx3-lg"><i style="background:${emph}"></i>Hub</span><span class="cx3-lg"><i style="border:.3cqw solid ${emph}"></i>Node</span></div>
  </div>`;
};
// inline SVG line-icons (currentColor), a universal vocabulary so no icon implies a domain the brand isn't in.
const IC = (b) =>
  `<svg class="cx-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${b}</svg>`;
const ICON = {
  up: IC(`<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>`),
  down: IC(
    `<polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/>`,
  ),
  inbox: IC(
    `<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>`,
  ),
  gear: IC(
    `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>`,
  ),
  check: IC(
    `<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>`,
  ),
  layers: IC(
    `<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>`,
  ),
  target: IC(
    `<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>`,
  ),
  grid: IC(
    `<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>`,
  ),
  bolt: IC(`<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>`),
  globe: IC(
    `<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>`,
  ),
  spark: IC(
    `<path d="M12 2v6M12 16v6M2 12h6M16 12h6M5 5l3.5 3.5M15.5 15.5 19 19M19 5l-3.5 3.5M8.5 15.5 5 19"/>`,
  ),
  arrow: `<svg class="cx-arrow" viewBox="0 0 40 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="2" y1="12" x2="33" y2="12"/><polyline points="25 4 35 12 25 20"/></svg>`,
};
// rotate grounds across archetypes: cover on canvas, content frames through the ranked grounds.
const canvasGround = ["canvas", canvas, onColorFor(canvas)];
// half-and-half comparison: header pill + 50% divider + two-tone panels, each with label + display term + icon.
const comparePane = (bg, on, emph, label, big, serif, icon) =>
  `<section class="cx2-pane" style="background:${bg};color:${on}">
    <div class="cx2-plabel">${label}</div>
    <div class="cx2-pbig">${big}</div>
    <div class="cx2-pserif" style="color:${emph}">${serif}</div>
    <div class="cx2-picon">${icon}</div>
  </section>`;
const compareFrame = (gA, gB) => {
  const bgA = gA[1],
    onA = gA[2] ?? onColorFor(bgA),
    emphA = emphasisOn(bgA);
  const bgB = gB[1],
    onB = gB[2] ?? onColorFor(bgB),
    emphB = emphasisOn(bgB);
  return `<div class="frame cx2 cx2-split" style="background:${bgA};color:${onA}">
    <div class="cx2-tex"></div>
    <div class="cx2-splithd" style="border-color:${onA}2e"><span class="cx2-splitpill" style="border-color:${onA}66">The Trade-off</span></div>
    <div class="cx2-splitmain">
      <div class="cx2-splitdiv" style="background:${onA}2e"></div>
      ${comparePane(bgA, onA, emphA, "Expansive", "SIGNAL", "amplified", ICON.up)}
      ${comparePane(bgB, onB, emphB, "Restrictive", "NOISE", "filtered", ICON.down)}
    </div>
    <div class="cx2-splitft" style="border-color:${onA}2e"><span>Trade-off</span><span>Frame System · 2026</span></div>
  </div>`;
};
// Centered drawn beats + the two asset frames. Grounds rotate so a dark full-bleed frame lands in
// the set; the asset frames anchor with a real image (element + background).
const composed = [
  cxCell(coverFrame(canvasGround), "Identity / Cover", "avatar overlay + wordmark"),
  cxCell(claimFrame(g(1)), "Oversized Claim", "serif-italic statement"),
  cxCell(
    compareFrame(canvasGround, ["accent", accent, onColorFor(accent)]),
    "Comparison",
    "half-and-half · two-tone",
  ),
  cxCell(statFrame(g(2)), "Avatar + Overlay", "presenter + audio waveform"),
  cxCell(networkFrame(g(4)), "System Map", "hub-spoke · ported from FOMC diagram"),
  cxCell(assetElFrame(g(2)), "Asset · Element", "photo + accent ring"),
  cxCell(assetBgFrame(g(1)), "Asset · Background", "full-bleed + scrim"),
].join("");
// keep the material/focal frame (glass or card on gradient + giant CTA) as the 5th
const focalCell = cell(
  "plate",
  plateInner,
  `Focal · ${hasGlass ? "glass on gradient" : "material"}`,
  "focal",
  "material",
);

const swatches = Object.entries(colors)
  .map(
    ([k, v]) =>
      `<div class="sw"><div class="chip" style="background:${v}"></div><div class="sm"><b>${k}</b><code>${v}</code></div></div>`,
  )
  .join("");

// brand-neutral type specimens (no source-brand copy).
const sampleFor = (role) =>
  ({
    heading: "A clear, confident headline",
    display: "The opening line",
    "heading-2": "A supporting subhead",
    "heading-3": "Section title in one line",
    "heading-4": "A smaller section title",
    "body-small": "A short line of body copy that sets the context in a sentence or two.",
    label: "SECTION · LABEL",
    code: "const frame = compose(scene);",
    "display-hero": "Said once.",
    "wordmark-mega": "Aa",
  })[role] ?? `Aa — ${role}`;

// type color is a palette role key (→ CSS var) OR a literal hex (a brand-inked heading kept verbatim)
const typeColor = (c) => (/^#/.test(String(c)) ? c : `var(--${c}, ${ink})`);
const typeRows = types
  .map((t) => {
    const ls = t.tracking ? `letter-spacing:${t.tracking};` : "";
    const shown = Math.min(t.px, 92); // cap specimen so huge hero sizes stay on one line
    return `<div class="trow"><div class="tmeta"><b>${t.role}</b><span>${t.fontFamily} ${t.weight} · ${Math.round(t.px)}px${t.cqw != null ? ` · ${t.cqw}cqw` : ""}</span></div>
      <div class="tspec" style="font-family:'${t.fontFamily}',sans-serif;font-size:${shown}px;font-weight:${t.weight};line-height:${t.lineHeight};${ls}color:${typeColor(t.color)}">${sampleFor(t.role)}</div></div>`;
  })
  .join("");

// video-native atoms from brand tokens: universal core + material-specific ones the capture actually has.
const findComp = (re) => components.find((c) => re.test(c.name));
const secondaryTok = findComp(/^button-secondary$/);
const cardTok = findComp(/^card$/);
const glassTok = findComp(/^glass-panel$/);
const btnBg = btnPrimary ? resolveRefs(btnPrimary.props.backgroundColor ?? "{colors.ink}") : ink;
const btnFg = btnPrimary ? resolveRefs(btnPrimary.props.textColor ?? "{colors.canvas}") : canvas;
const btnRad = btnPrimary ? resolveRefs(btnPrimary.props.rounded ?? r1) : r1;
const pillRad = /9999|999|50%/.test(String(radii.r2)) ? resolveRefs(radii.r2) : "999px";
const cardRad = cardTok ? resolveRefs(cardTok.props.rounded ?? r1) : r1;
const cardShadow =
  cardTok && cardTok.props.shadow && cardTok.props.shadow !== "none"
    ? resolveRefs(cardTok.props.shadow)
    : `inset 0 0 0 1px ${chipHair}`;
const labelFont = types.find((t) => t.role === "label")?.fontFamily ?? bodyFont;
const videoComps = [
  {
    name: "kicker",
    demo: `<div class="v-kick" style="color:${accent};font-family:'${labelFont}'">◆&nbsp;&nbsp;SECTION LABEL</div>`,
  },
  {
    name: "title lockup",
    demo: `<div class="v-lock"><div class="v-lock-h" style="font-family:'${dispFont}'">Headline set here</div><span class="v-rule" style="background:${accent}"></span></div>`,
  },
  {
    name: "lower-third",
    demo: `<div class="v-lt" style="border-left:4px solid ${accent}"><div class="v-lt-t" style="font-family:'${dispFont}'">Name Here</div><div class="v-lt-s" style="font-family:'${labelFont}'">ROLE · SUBTITLE</div></div>`,
  },
  {
    name: "caption",
    demo: `<div class="v-cap" style="background:${ink};color:${onColorFor(ink)};border-radius:${pillRad}">the spoken line, captioned</div>`,
  },
  {
    name: "CTA end-card",
    demo: `<span class="v-cta" style="background:${btnBg};color:${btnFg};border-radius:${btnRad};font-family:'${dispFont}'">Get started</span>`,
  },
  // ── brand-specific: only present when the capture actually has the material ──
  secondaryTok && {
    name: "ghost button",
    demo: `<span class="v-cta v-ghost" style="border:1.5px solid ${resolveRefs(secondaryTok.props.border?.match(/\{colors\.[\w-]+\}|#[0-9a-fA-F]{6}/)?.[0] ?? "{colors.ink-muted}")};color:${resolveRefs(secondaryTok.props.textColor ?? "{colors.ink}")};border-radius:${resolveRefs(secondaryTok.props.rounded ?? btnRad)};font-family:'${dispFont}'">Learn more</span>`,
  },
  cardTok && {
    name: "callout card",
    demo: `<div class="v-card" style="border-radius:${cardRad};box-shadow:${cardShadow};background:${canvas}"><div class="v-card-k" style="color:${accent};font-family:'${labelFont}'">PULL-QUOTE</div><div class="v-card-t" style="font-family:'${dispFont}'">A line worth framing.</div></div>`,
  },
  glassTok && {
    name: "glass panel",
    demo: `<div class="v-glasswrap" style="background:${brandWash ?? `linear-gradient(120deg, ${accent}, ${canvas})`}"><div class="v-glass" style="background:${resolveRefs(glassTok.props.backgroundImage ?? "rgba(255,255,255,.4)")};backdrop-filter:${glassTok.props.backdropFilter ?? "blur(12px)"};border-radius:${resolveRefs(glassTok.props.rounded ?? r1)};font-family:'${dispFont}'">Frosted</div></div>`,
  },
  {
    name: "badge / tag",
    demo: `<span class="v-badge" style="border-color:${accent};color:${accent};border-radius:${pillRad};font-family:'${labelFont}'">NEW</span>`,
  },
  accents.length >= 2 && {
    name: "brand spectrum",
    demo: `<div class="v-spec" style="background:${brandWash}"></div>`,
  },
  {
    name: "progress",
    demo: `<div class="v-prog"><span style="width:62%;background:${accent}"></span></div>`,
  },
].filter(Boolean);
const compRow = videoComps
  .map((c) => `<div class="cdemo"><div class="cnote">${c.name}</div>${c.demo}</div>`)
  .join("");

// Foundations — radius / spacing / elevation: real captured tokens the showcase used to hide entirely.
const radiiRow = Object.entries(radii)
  .map(
    ([k, v]) =>
      `<div class="fitem"><div class="fbox" style="border-radius:${resolveRefs(v)}"></div><div class="fmeta"><b>${k}</b><code>${v}</code></div></div>`,
  )
  .join("");
const spaceVals = Object.entries(spacing).map(([k, v]) => [k, v, parseFloat(v) || 0]);
const spaceMax = Math.max(1, ...spaceVals.map(([, , n]) => n));
const spacingRow = spaceVals
  .map(
    ([k, v, n]) =>
      `<div class="fspace"><div class="fbar" style="width:${Math.max(4, (n / spaceMax) * 66)}%;background:${accent}"></div><div class="fmeta"><b>${k}</b><code>${v}</code></div></div>`,
  )
  .join("");
const shadowRow = Object.entries(shadows)
  .map(([k, v]) => `<div class="fcard" style="box-shadow:${resolveRefs(v)}"><b>${k}</b></div>`)
  .join("");
const foundationsSection =
  radiiRow || spacingRow || shadowRow
    ? `<section>
      <div class="sec-head"><span class="bar"></span><h2>Foundations</h2><span class="idx">03 · radius · spacing · elevation</span></div>
      <div class="panel fpanel">
        ${radiiRow ? `<div class="fgroup"><div class="flabel">Radius</div><div class="frow">${radiiRow}</div></div>` : ""}
        ${spacingRow ? `<div class="fgroup"><div class="flabel">Spacing scale</div><div class="fcol">${spacingRow}</div></div>` : ""}
        ${shadowRow ? `<div class="fgroup"><div class="flabel">Elevation</div><div class="frow">${shadowRow}</div></div>` : ""}
      </div>
    </section>`
    : "";

// rough page height so the screenshot isn't clipped
const boardW = 1280;
const coverH = Math.round((boardW * 9) / 16);
const frameInnerW = (1180 - 96 - 40) / 2;
// sheet = 2-col grid of all composed cells; budget the real row count so nothing clips.
const SHEET_CELLS = 8;
const sheetRows = Math.ceil(SHEET_CELLS / 2);
const sheetRowH = Math.round((frameInnerW * 9) / 16) + 64;
const sheetH = sheetRows * sheetRowH + (sheetRows - 1) * 40 + 120;
const portraitFrameW = 320;
// portrait frame height + rail + section head + section padding, with margin so it never clips
const portraitH = Math.round((portraitFrameW * 16) / 9) + 60 + 90 + 108;
// Foundations section: radius+spacing+elevation groups + heading/pad (0 when frame.md has none).
const foundationsH = foundationsSection
  ? 130 +
    (radiiRow ? 150 : 0) +
    (spacingRow ? Object.keys(spacing).length * 30 + 60 : 0) +
    (shadowRow ? 140 : 0)
  : 0;
const docH = 360 + (types.length * 72 + 150) + foundationsH + 320 + sheetH + portraitH + 260;
const boardH = coverH + docH;

const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>${fontFace.replace(/<\/?style>/g, "")}</style>
<style>
  :root{ ${cssVars} --disp:'${dispFont}',sans-serif; --body:'${bodyFont}',sans-serif; --serif:'Instrument Serif',Georgia,serif; --mono:'JetBrains Mono',ui-monospace,monospace }
  *{margin:0;box-sizing:border-box}
  html{background:${galleryBg}}
  body{width:${boardW}px;background:${galleryBg};color:${docInk};font-family:var(--body)}

  /* full-bleed cover (a real 16:9 frame, first element) */
  .frame{ container-type:size; position:relative; overflow:hidden; background:${canvas}; color:${ink} }
  .frame .fill{ position:absolute; inset:0; padding:6cqw; display:flex; flex-direction:column }
  /* cover sits on the real page ground (canvas) — a captured gradient is a LOCAL decoration on the
     site, not the page background, so we no longer slap it full-frame as a rigid blob. */
  .cover{ width:100%; aspect-ratio:16/9; background:${canvas} }
  .eyebrow{ font-family:var(--disp); font-size:${eyebrowCqw}cqw; letter-spacing:.22em; text-transform:uppercase; color:${accent}; white-space:nowrap }
  .aline{ width:9cqw; height:.5cqw; background:${accent}; margin-bottom:2.4cqw }
  .wordmark{ font-family:var(--disp); font-size:${wmCqw}cqw; font-weight:${parseTypo(btnPrimary?.props.typography).weight}; line-height:.96; letter-spacing:-.03em; color:${ink}; margin-top:auto; max-height:60cqh; overflow:hidden }
  .coversub{ font-family:var(--body); font-size:1.9cqw; color:${inkMuted}; max-width:60cqw; margin-top:1.6cqw }
  .counter{ position:absolute; right:6cqw; bottom:6cqw; font-family:var(--disp); font-size:1.5cqw; letter-spacing:.1em; color:${inkMuted} }
  .pbar{ position:absolute; left:0; bottom:0; height:.7cqw; width:38%; background:${brandWash ?? accent} }

  /* doc chrome — wears the brand on a ground derived from the brand's own luminance */
  .doc{ max-width:1180px; margin:0 auto; padding:96px 48px 140px }
  section{ padding:54px 0; border-top:1px solid ${secBorder} }
  .sec-head{ display:flex; align-items:center; gap:16px; margin-bottom:34px }
  .sec-head .bar{ width:34px; height:4px; background:${accent} }
  .sec-head h2{ font-family:var(--disp); font-weight:600; font-size:30px; color:${docInk}; letter-spacing:-.01em }
  .sec-head .idx{ font-family:var(--disp); color:${docFaint}; font-size:15px; margin-left:auto; letter-spacing:.1em }

  .panel{ background:${canvas}; color:${ink}; border-radius:14px; padding:40px; box-shadow:${frameShadow} }
  .swatches{ display:grid; grid-template-columns:repeat(5,1fr); gap:20px }
  .sw .chip{ height:84px; border-radius:${r1}; box-shadow:inset 0 0 0 1px ${chipHair} }
  .sm b{ font-family:var(--disp); font-size:14px; display:block; margin-top:10px } .sm code{ font-size:12px; opacity:.7 }

  .trow{ display:grid; grid-template-columns:230px 1fr; gap:24px; align-items:center; padding:16px 0; border-bottom:1px solid ${secBorder} }
  .tmeta b{ font-family:var(--disp); font-size:15px; display:block } .tmeta span{ font-size:12px; opacity:.68 }
  .tspec{ white-space:nowrap; overflow:hidden; text-overflow:ellipsis }

  .comprow{ display:flex; gap:36px 40px; flex-wrap:wrap; align-items:flex-end }
  .cdemo{ display:flex; flex-direction:column; gap:12px }
  .cnote{ font-size:12px; letter-spacing:.06em; opacity:.68; font-family:var(--disp) }
  /* video-native component kit (built from brand tokens) */
  .v-kick{ font-size:13px; font-weight:700; letter-spacing:.16em; text-transform:uppercase }
  .v-lock{ display:flex; flex-direction:column; gap:9px; align-items:flex-start }
  .v-lock-h{ font-size:26px; font-weight:700; color:${ink}; line-height:1 }
  .v-rule{ width:52px; height:4px; border-radius:2px }
  .v-lt{ padding:10px 16px; background:${canvas}; box-shadow:${frameShadow}; border-radius:6px }
  .v-lt-t{ font-size:19px; font-weight:700; color:${ink}; line-height:1.1 }
  .v-lt-s{ font-size:11px; letter-spacing:.12em; text-transform:uppercase; opacity:.62; margin-top:3px }
  .v-cap{ padding:9px 18px; font-size:15px; font-weight:600; max-width:240px }
  .v-cta{ display:inline-block; padding:13px 26px; font-size:16px; font-weight:700 }
  .v-badge{ display:inline-block; padding:5px 14px; border:1.5px solid; font-size:12px; font-weight:700; letter-spacing:.1em }
  .v-ghost{ background:transparent !important }
  .v-card{ width:210px; padding:18px 20px; display:flex; flex-direction:column; gap:8px; align-items:flex-start }
  .v-card-k{ font-size:11px; font-weight:700; letter-spacing:.14em; text-transform:uppercase }
  .v-card-t{ font-size:19px; font-weight:700; color:${ink}; line-height:1.15 }
  .v-glasswrap{ padding:16px; border-radius:14px; display:inline-flex }
  .v-glass{ padding:14px 22px; font-size:15px; font-weight:700; color:${ink}; box-shadow:0 6px 20px rgba(0,0,0,.16) }
  .v-spec{ width:230px; height:44px; border-radius:8px }
  .v-prog{ width:230px; height:8px; border-radius:999px; background:${chipHair}; overflow:hidden } .v-prog span{ display:block; height:100% }

  /* foundations — radius / spacing / elevation */
  .fpanel{ display:flex; flex-direction:column; gap:34px }
  .fgroup{ display:flex; flex-direction:column; gap:16px }
  .flabel{ font-family:var(--disp); font-size:13px; letter-spacing:.12em; text-transform:uppercase; opacity:.6 }
  .frow{ display:flex; gap:34px; flex-wrap:wrap; align-items:flex-end }
  .fcol{ display:flex; flex-direction:column; gap:14px; max-width:560px }
  .fitem{ display:flex; flex-direction:column; gap:10px }
  .fbox{ width:96px; height:64px; background:${accent}; box-shadow:inset 0 0 0 1px ${chipHair} }
  .fmeta b{ font-family:var(--disp); font-size:14px; display:inline-block; margin-right:8px } .fmeta code{ font-size:12px; opacity:.66 }
  .fspace{ display:flex; align-items:center; gap:16px }
  .fbar{ height:14px; border-radius:3px; flex:none }
  .fcard{ width:150px; height:78px; background:${canvas}; border-radius:12px; display:flex; align-items:flex-end; padding:12px } .fcard b{ font-family:var(--disp); font-size:13px; opacity:.7 }
  .spectrum{ height:22px; border-radius:8px; margin-top:22px; box-shadow:inset 0 0 0 1px ${chipHair} }
${compCss}

  /* contact sheet of composed frames */
  .sheet{ display:grid; grid-template-columns:repeat(2,1fr); gap:40px }
  .cell .frame{ width:100%; aspect-ratio:16/9; border-radius:10px; box-shadow:${frameShadow} }
  .rail{ display:flex; gap:10px; align-items:baseline; padding:12px 2px 0 }
  .rail .rn{ font-family:var(--disp); color:${railName}; font-size:14px } .rail .ra{ color:${railAttr}; font-size:12px; letter-spacing:.04em }
  .portrait{ display:flex; gap:32px }
  .portrait .cell .frame{ width:${portraitFrameW}px; aspect-ratio:9/16 }

  /* per-archetype frame internals (all in cqw → true frame proportions) */
  .claim{ font-family:var(--disp); font-size:${Math.min(heroCqw + 2, 12)}cqw; font-weight:${parseTypo(btnPrimary?.props.typography).weight}; line-height:1.0; letter-spacing:-.02em; color:${ink}; margin:auto 0; max-width:78cqw }
  .claim em{ font-style:normal; color:${accent} }
  /* focal-artifact: the captured gradient as the frame GROUND, a floating glass/card panel as the
     MATERIAL, and the frame-scale CTA composed on top — background + material + component as one. */
  .plate{ background:${focalGround} }
  .platewrap{ margin:auto 0; width:100%; display:flex; justify-content:center }
  .platepanel{ width:58cqw; flex-direction:column !important; align-items:flex-start !important; justify-content:center; gap:2cqw; padding:5cqw; ${panelBg}border:1px solid ${chipHair}; box-shadow:0 2cqw 6cqw rgba(0,0,0,.24) }
  .platepanel .cardk{ font-family:var(--body); font-size:1.7cqw; color:${ink}; opacity:.72; text-transform:uppercase; letter-spacing:.12em }
  .platepanel .cardv{ font-family:var(--disp); font-size:9cqw; color:${ink}; line-height:.92; margin-bottom:1cqw }
  .c-button-primary-giant{ white-space:nowrap }

  /* grounds-driven editorial-chrome frames */
  .cx{ display:flex; flex-direction:column; overflow:hidden }
  .cx-tex{ position:absolute; inset:0; background:radial-gradient(120% 90% at 24% 12%, currentColor 0, transparent 62%); opacity:.06; pointer-events:none }
  .cx-rail{ display:flex; justify-content:space-between; align-items:center; padding:2.4cqw 4cqw; font-family:var(--disp); font-size:1.15cqw; letter-spacing:.16em; text-transform:uppercase; z-index:1 }
  .cx-top{ border-bottom:1px solid currentColor }
  .cx-bot{ border-top:1px solid currentColor; margin-top:auto }
  .cx-status{ display:flex; align-items:center; gap:.7cqw } .cx-status i{ width:.85cqw; height:.85cqw; border-radius:50%; display:block }
  .cx-main{ flex:1; display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center; padding:3.5cqw 4cqw; gap:1.6cqw; z-index:1 }
  .cx-eye{ font-family:var(--disp); font-size:1.35cqw; letter-spacing:.22em; text-transform:uppercase; font-weight:700 }
  .cx-word{ font-family:var(--disp); font-size:${wmCqw}cqw; line-height:.94; letter-spacing:-.03em; font-weight:800; max-height:52cqh; overflow:hidden }
  .cx-sub{ font-family:var(--body); font-size:1.7cqw; opacity:.72 }
  .cx-claim{ font-family:var(--disp); font-size:${Math.min(heroCqw + 1, 9.5)}cqw; line-height:1.02; letter-spacing:-.02em; font-weight:800; max-width:82cqw } .cx-claim em{ font-style:normal }
  /* ── rebuilt first-three beats (real video-agent idiom) ── */
  .cx2{ position:relative; overflow:hidden }
  .cx2-tex{ position:absolute; inset:0; opacity:.09; background-image:radial-gradient(currentColor 1px,transparent 1px); background-size:2.2cqw 2.2cqw; pointer-events:none }
  .cx2-kick{ position:absolute; top:5cqw; left:6cqw; z-index:2; font-family:var(--mono); font-size:1.5cqw; letter-spacing:.2em; text-transform:uppercase; display:flex; align-items:center; gap:1.1cqw }
  .cx2-kick::before{ content:""; width:3.2cqw; height:1px; background:currentColor }
  .cx2-ft{ position:absolute; left:6cqw; right:6cqw; bottom:3.4cqw; z-index:2; display:flex; justify-content:space-between; font-family:var(--mono); font-size:1.2cqw; letter-spacing:.12em; text-transform:uppercase; border-top:1px solid; padding-top:1.4cqw; opacity:.85 }
  /* Claim = pure typographic b_roll */
  .cx2-claim-main{ position:absolute; inset:0; z-index:1; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; gap:.3cqw; padding:0 8cqw }
  .cx2-bigline{ font-family:var(--disp); font-weight:800; font-size:7.2cqw; line-height:1.0; letter-spacing:-.02em }
  .cx2-serif-lg{ font-family:var(--serif); font-style:italic; font-size:8.6cqw; line-height:.92 }
  /* A-roll = full-frame talking-head avatar (real bg) + transparent overlay detail on top */
  .cx2-aroll{ position:relative; overflow:hidden }
  .cx2-arimg{ position:absolute; inset:0; width:100%; height:100%; object-fit:cover; object-position:center 16% }
  .cx2-arscrim{ position:absolute; inset:0 }
  .cx2-arpill{ position:absolute; top:5cqw; left:5cqw; z-index:2; font-family:var(--mono); font-size:1.5cqw; letter-spacing:.2em; text-transform:uppercase; border:1px solid #ffffffaa; border-radius:999px; padding:.9cqw 2.4cqw }
  .cx2-arstamp{ position:absolute; right:5cqw; bottom:6cqw; z-index:2; font-family:var(--mono); font-size:1.5cqw; letter-spacing:.18em; opacity:.9 }
  /* cover overlay stays bottom-left — off the face */
  .cx2-arlower{ position:absolute; left:5cqw; bottom:6cqw; z-index:2; max-width:60cqw }
  .cx2-areye{ font-family:var(--mono); font-size:1.4cqw; letter-spacing:.2em; text-transform:uppercase; opacity:.85; margin-bottom:1cqw }
  .cx2-artitle{ font-family:var(--serif); font-style:italic; font-size:7.5cqw; line-height:.92; text-shadow:0 .3cqw 2.4cqw rgba(0,0,0,.5) }
  .cx2-arrule{ display:block; width:12cqw; height:.55cqw; margin-top:1.6cqw; border-radius:999px }
  /* network (hub-spoke, ported from FOMC Members Diagram) */
  .cx3-net{ position:relative; overflow:hidden }
  .cx3-head{ position:absolute; top:5cqw; left:5cqw; z-index:3 }
  .cx3-title{ font-family:var(--disp); font-weight:800; font-size:4.4cqw; text-transform:uppercase; letter-spacing:-.02em; line-height:1 }
  .cx3-sub{ font-family:var(--mono); font-size:1.5cqw; letter-spacing:.14em; text-transform:uppercase; opacity:.7; margin-top:.8cqw }
  .cx3-diagram{ position:absolute; left:50%; top:55%; transform:translate(-50%,-50%); width:40cqw; height:40cqw }
  .cx3-svg{ position:absolute; inset:0; width:100%; height:100% }
  .cx3-hub{ position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:30%; height:30%; border-radius:50%; display:flex; align-items:center; justify-content:center; font-family:var(--disp); font-weight:800; font-size:2.8cqw; letter-spacing:.04em; z-index:4; box-shadow:0 1cqw 3cqw rgba(0,0,0,.2) }
  .cx3-node{ position:absolute; transform:translate(-50%,-50%); display:flex; flex-direction:column; align-items:center; width:22cqw; z-index:3 }
  .cx3-ndot{ width:5cqw; height:5cqw; border-radius:50%; border:.45cqw solid; display:flex; align-items:center; justify-content:center }
  .cx3-ndot i{ width:1.5cqw; height:1.5cqw; border-radius:50%; display:block }
  .cx3-nlab{ font-family:var(--disp); font-weight:700; font-size:2cqw; margin-top:.7cqw }
  .cx3-legend{ position:absolute; right:5cqw; bottom:4.5cqw; z-index:3; display:flex; gap:2.4cqw; font-family:var(--mono); font-size:1.4cqw; text-transform:uppercase; letter-spacing:.08em; opacity:.85 }
  .cx3-lg{ display:flex; align-items:center; gap:.8cqw } .cx3-lg i{ width:1.4cqw; height:1.4cqw; border-radius:50%; display:inline-block }
  /* Forward Guidance lower-third — the card IS the container; content padded inside it */
  .cx2-fgcard{ position:absolute; left:4cqw; bottom:4cqw; z-index:2; display:inline-flex; flex-direction:column; align-items:flex-start; gap:1.3cqw; padding:2.8cqw 3cqw; border-radius:1.6cqw; max-width:52cqw; box-shadow:0 1cqw 4cqw rgba(0,0,0,.28) }
  .cx2-lt-pill{ width:fit-content; padding:.6cqw 1.8cqw; border:.14cqw solid; border-radius:999px; font-family:var(--mono); font-size:1.3cqw; text-transform:uppercase; letter-spacing:.1em }
  .cx2-lt-eye{ font-family:var(--mono); font-size:1.3cqw; text-transform:uppercase; letter-spacing:.15em; opacity:.78 }
  .cx2-lt-head{ font-family:var(--disp); font-weight:800; font-size:4.6cqw; line-height:.95; letter-spacing:-.02em }
  .cx2-lt-wave{ display:flex; align-items:center; gap:.35cqw; height:4.5cqw }
  .cx2-fgbar{ width:.42cqw; border-radius:999px; flex:none; min-height:1cqw }
  /* faithful half-and-half comparison (QE/QT idiom) */
  .cx2-split{ position:relative; display:flex; flex-direction:column; overflow:hidden }
  .cx2-splithd{ height:15cqh; display:flex; align-items:center; justify-content:center; border-bottom:1px solid; z-index:2 }
  .cx2-splitpill{ font-family:var(--mono); font-size:1.5cqw; letter-spacing:.2em; text-transform:uppercase; border:1px solid; border-radius:999px; padding:.8cqw 2.8cqw }
  .cx2-splitmain{ flex:1; display:grid; grid-template-columns:1fr 1fr; position:relative; min-height:0 }
  .cx2-splitdiv{ position:absolute; left:50%; top:0; bottom:0; width:1px; transform:translateX(-50%); z-index:3 }
  .cx2-pane{ display:flex; flex-direction:column; align-items:center; justify-content:center; gap:.4cqw; padding:3cqw; overflow:hidden }
  .cx2-plabel{ font-family:var(--mono); font-size:1.45cqw; letter-spacing:.2em; text-transform:uppercase; opacity:.82 }
  .cx2-pbig{ font-family:var(--disp); font-weight:800; font-size:11cqw; line-height:.86; letter-spacing:-.03em }
  .cx2-pserif{ font-family:var(--serif); font-style:italic; font-size:5cqw; line-height:.9 }
  .cx2-picon{ margin-top:1.4cqw } .cx2-picon svg{ width:6.5cqw; height:6.5cqw }
  .cx2-splitft{ height:10cqh; display:flex; align-items:center; justify-content:space-between; padding:0 5cqw; border-top:1px solid; font-family:var(--mono); font-size:1.3cqw; letter-spacing:.14em; text-transform:uppercase; opacity:.85; z-index:2 }
  .cx-num{ font-family:var(--disp); font-size:17cqw; line-height:.84; letter-spacing:-.03em; font-weight:800 }
  .cx-spark{ width:34cqw; height:5cqw; display:block }
  .cx-lab{ font-family:var(--body); font-size:1.6cqw; opacity:.72 }
  .cx-cmp{ display:grid; grid-template-columns:1fr 1fr; gap:2.5cqw; margin-top:1cqw }
  .cx-pane{ border:1px solid currentColor; border-radius:${r1}; padding:3cqw; display:flex; flex-direction:column; align-items:center; text-align:center; gap:1.2cqw }
  .cx-pk{ font-family:var(--body); font-size:1.4cqw; text-transform:uppercase; letter-spacing:.12em; opacity:.7 }
  .cx-pv{ font-family:var(--disp); font-size:5.5cqw; font-weight:800; line-height:1 }
  .cx-focus{ margin:1cqw 0 } .cx-focus svg{ width:16cqw; height:16cqw; display:block; stroke-width:1.3 }
  /* inline SVG icons + flow-diagram nodes/connectors */
  .cx-ic{ width:6cqw; height:6cqw; display:block }
  .cx-flow{ display:flex; align-items:center; justify-content:center; gap:1.8cqw; margin-top:1cqw }
  .cx-node{ border:1px solid currentColor; border-radius:${r1}; padding:2.6cqw 2cqw; display:flex; flex-direction:column; align-items:center; gap:1cqw; min-width:17cqw }
  .cx-nl{ font-family:var(--disp); font-size:2.2cqw; font-weight:800; line-height:1 }
  .cx-ns{ font-family:var(--body); font-size:1.15cqw; opacity:.6; text-transform:uppercase; letter-spacing:.12em }
  .cx-conn{ display:flex; align-items:center } .cx-arrow{ width:5cqw; height:3cqw; display:block }
  /* ── asset frames: element (masked photo + accent ring) + background (full-bleed + scrim) ── */
  .cx-asset .cx-tex{ opacity:.05 }
  .cx-ael{ flex:1; display:flex; align-items:center; gap:3cqw; padding:4cqw 4.5cqw; z-index:1 }
  .cx-aet{ flex:1; display:flex; flex-direction:column; gap:2cqw; text-align:left }
  .cx-aeh{ font-family:var(--disp); font-size:8cqw; line-height:.96; letter-spacing:-.02em; font-weight:800 } .cx-aeh em{ font-style:normal }
  .cx-abadges{ display:flex; flex-wrap:wrap; gap:1.2cqw; margin-top:1cqw }
  .cx-badge{ display:inline-flex; align-items:center; gap:.8cqw; border:1px solid currentColor; border-radius:999px; padding:1cqw 2.2cqw; font-family:var(--disp); font-weight:700; font-size:1.9cqw; letter-spacing:.02em }
  .cx-badge svg{ width:2.6cqw; height:2.6cqw }
  .cx-aeimg{ position:relative; width:40cqw; height:40cqw; flex:none; display:flex; align-items:center; justify-content:center }
  .cx-orbit{ position:absolute; inset:-1cqw; border-radius:50%; border:1px dashed currentColor; opacity:.6 }
  .cx-circ{ width:34cqw; height:34cqw; border-radius:50%; overflow:hidden; border:1cqw solid currentColor; box-shadow:0 2cqw 5cqw rgba(0,0,0,.28) }
  .cx-circ img{ width:100%; height:100%; object-fit:cover; display:block }
  .cx-assetbg{ position:relative }
  .cx-bgimg{ position:absolute; inset:0; width:100%; height:100%; object-fit:cover; z-index:0 }
  .cx-scrim{ position:absolute; inset:0; z-index:1 }
  .cx-bgmain{ position:relative; z-index:2 }
</style></head>
<body>
  <!-- cover: full-bleed identity frame, before any doc chrome -->
  <div class="cover frame"><div class="fill">${coverInner}</div></div>

  <div class="doc">
    <section style="border-top:0">
      <div class="sec-head"><span class="bar"></span><h2>Palette</h2><span class="idx">01${accents.length >= 2 ? " · brand spectrum" : ""}</span></div>
      <div class="panel"><div class="swatches">${swatches}</div>${brandWash ? `<div class="spectrum" style="background:${brandWash}"></div>` : ""}</div>
    </section>

    <section>
      <div class="sec-head"><span class="bar"></span><h2>Typography</h2><span class="idx">02 · two ramps</span></div>
      <div class="panel">${typeRows}</div>
    </section>

    ${foundationsSection}

    <section>
      <div class="sec-head"><span class="bar"></span><h2>Components</h2><span class="idx">04 · video-ready atoms</span></div>
      <div class="panel"><div class="comprow">${compRow}</div></div>
    </section>

    <section>
      <div class="sec-head"><span class="bar"></span><h2>Frame Compositions</h2><span class="idx">05 · 16:9</span></div>
      <div class="sheet">
        ${composed}
        ${focalCell}
      </div>
    </section>

    <section>
      <div class="sec-head"><span class="bar"></span><h2>Portrait · 9:16</h2><span class="idx">06 · reflow proof</span></div>
      <div class="portrait">
        ${cxCell(cxFrame("cx-cover", canvasGround, aCover), "Cover", "9:16")}
        ${cxCell(assetBgFrame(g(1)), "Asset", "9:16")}
        ${cxCell(cxFrame("cx-st", g(2), aStat), "Stat", "9:16")}
      </div>
    </section>
  </div>
</body></html>`;

const htmlPath = join(outDir, "frame-showcase.html");
const pngPath = join(outDir, "showcase.png");
writeFileSync(htmlPath, html);

if (!CHROME) {
  console.log(
    `✓ wrote ${htmlPath} (no Chrome found — open it manually; pass --chrome <path> to screenshot)`,
  );
  process.exit(0);
}

const profile = mkdtempSync(join(tmpdir(), "fg-chrome-"));
const before = statSafe(pngPath);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const child = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    ...(noSandbox ? ["--no-sandbox", "--disable-setuid-sandbox"] : []),
    `--user-data-dir=${profile}`,
    "--force-device-scale-factor=1",
    `--default-background-color=${galleryBg.replace("#", "")}ff`,
    `--screenshot=${pngPath}`,
    `--window-size=${boardW},${boardH}`,
    "--virtual-time-budget=4000",
    `file://${htmlPath}`,
  ],
  { stdio: "ignore" },
);
let done = null;
for (let waited = 0; waited < 20000; waited += 300) {
  await sleep(300);
  const s = statSafe(pngPath);
  if (s && s.size > 0 && (!before || s.mtimeMs !== before.mtimeMs)) {
    await sleep(300);
    const s2 = statSafe(pngPath);
    if (s2 && s2.size === s.size) {
      done = s2;
      break;
    }
  }
  if (child.exitCode != null) break;
}
try {
  child.kill("SIGKILL");
} catch {
  // already gone
}
if (!done) die(`Chrome did not produce a screenshot at ${pngPath}`);
console.log(
  `✓ render-showcase → ${pngPath}  (${boardW}×${boardH}, ${Math.round(done.size / 1024)}KB)`,
);
console.log(`  html: ${htmlPath}`);
console.log(`  compare against: ${join(baseDir, "screenshots/contact-sheet-1.jpg")}`);
