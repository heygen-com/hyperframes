---
title: "Send to HyperFrames"
description: "Author a Claude Design as a single-file HyperFrames composition for the \"Send to HyperFrames\" URL import."
---

# Claude Design → "Send to HyperFrames" (Single-File Import)

> This guide is **fully self-contained**: everything needed to author a valid "Send to HyperFrames" composition is inline here. Do not rely on fetching any other document — produce the composition from this guide alone.

Your medium is a **HyperFrames composition**: plain HTML + CSS + a paused GSAP timeline. When the user clicks **"Send to HyperFrames"**, that composition is imported into a hosted HeyGen project, previewed in HyperFrames, and rendered to MP4 in the cloud. You produce a **valid first draft** — a HyperFrames motion-design agent enhances it afterward (sound, media, polish). You are not producing the final video.

---

## How this path differs from download-ZIP

There are two ways a Claude Design composition can reach HyperFrames. **This guide is only about "Send to HyperFrames."**

| | Download-ZIP flow | **Send to HyperFrames (this guide)** |
| --- | --- | --- |
| Wire format | multi-file ZIP (`index.html` + `fonts/` + README) | **one self-contained HTML file** |
| How it travels | user downloads the ZIP | **the importer fetches one HTML** |
| Assets | referenced from sibling files (`fonts/…`) | **resolvable from the one file: inline `data:` URIs (preferred) or a publicly-fetchable absolute URL** |
| Next step | a coding agent polishes locally, renders via CLI | **enhanced inside HyperFrames; rendered in the cloud** |

The single most important consequence: **there is no file tree on the other side.** A relative path or sibling-file reference (`fonts/…`, `uploads/…`) simply does not arrive. Every asset must be **resolvable**: an inline `data:` URI (preferred — the only fully self-contained form) or a publicly-fetchable absolute URL, never a relative path or local-file variable (see *Asset & fidelity rules*).

---

## The workflow you're feeding into

1. **You (Claude Design)** — author a valid HyperFrames composition as a single self-contained HTML.
2. **Send to HyperFrames** — one click. The importer fetches your HTML, validates it, and creates a hosted HeyGen project. **Import is free.**
3. **Enhance in HyperFrames** — a motion-design agent adds what your export can't: sound effects, background music, and (later) HeyGen media. This is the paid step.
4. **Render** — the cloud pipeline produces the MP4.

Your job is step 1: a composition that imports cleanly and is a strong on-brand starting point.

---

## What you send: a single self-contained composition HTML

One `.html` file. Everything the composition needs to display its own content must live **inside** that file:

- All CSS inline (in `<style>` or style attributes).
- All **brand assets** (fonts, images, logos) inlined as base64 `data:` URIs.
- The GSAP timeline defined synchronously at page load and registered on `window.__timelines`.

The HyperFrames runtime, GSAP, and shader-transitions are loaded from the jsdelivr CDN (`cdn.jsdelivr.net/npm/@hyperframes/...`, `gsap@…`) — the render pipeline fetches those at render time by design. GSAP is version-pinned (`gsap@3.14.2`); the `@hyperframes` packages are served unversioned (latest published runtime), matching what a real import ships. Do **not** inline the runtime.

**Do NOT send a bundled / splash-loader artifact.** If your tooling wraps the composition in a loader that assembles the real content at runtime (a `<template>` splash, a base64 asset manifest, a `window.__resources` blob), the importer cannot read it and rejects it. Send the **raw composition HTML** whose real content is in the live DOM.

---

## The composition contract (the importer checks these — get them right or it 422s)

- **One live root** with `data-composition-id="main"` on a real element in the DOM — **not inside a `<template>`**. (Elements inside `<template>` are inert and don't count as the live root.)
- **Numeric** `data-width` and `data-height` on that root (e.g. `data-width="1920" data-height="1080"`).
- **Numeric** `data-duration` on the root (total seconds) and on each scene, plus `data-start` per scene.
- Scenes tile end-to-end within the total duration (no gaps).
- The timeline is **registered** and keyed to the composition id: `window.__timelines["main"] = tl`.
- The timeline is a **paused** GSAP timeline, built **synchronously** at load (the framework drives playback — see *Determinism*).

---

## Asset & fidelity rules (this is where Send-to differs most)

**Every asset must be resolvable from the single HTML file** — an inline `data:` URI (preferred; the only fully self-contained form) or a publicly-fetchable absolute URL. A relative path, sibling-file ref, or local-file variable is simply missing on import and renders blank.

| Asset | Usual (ZIP) advice | **Send-to requires** |
| --- | --- | --- |
| Fonts | `fonts/Brand.woff2` file ref | **base64 `data:font/…` in `@font-face` src** (one per weight/style used) |
| Images / logos | file ref or HTTPS URL | **inline base64 `data:image/…`** (images inline fine — a 1 MB photo is well under the cap); never a relative path or an expiring/private host |
| Video / audio (if any) | file ref | **inline `data:` URI if small; large media → a publicly-fetchable absolute URL** (inlining large media can exceed the import size cap); never a relative path or expiring/private host |
| Runtime / GSAP / shaders | — | **CDN `<script src>`** (do NOT inline) |

Inline a font like this (base64 elided):

```css
@font-face {
  font-family: "TT Norms Pro";
  font-weight: 800;
  font-style: normal;
  font-display: block;
  src: url(data:font/otf;base64,T1RUTwANAIAAAwBQ...) format("opentype");
}
```

Gotchas learned from real imports:

- **Inlining the brand font is what preserves fidelity.** If the font isn't inlined, it falls back to a system font and the brand look is lost. Do NOT use a Google Fonts `<link>` for a Send-to composition — inline the `@font-face` instead.
- **Prefer inline; never a dead or expiring ref.** Inline images/logos as `data:` URIs when practical — the only fully self-contained form. If an asset is too large to inline, use a **publicly-fetchable absolute URL**; never a relative path, a local-file variable, or a **short-lived/private host** (a signed URL that expires, `s3://`/presigned URLs) — those 404 by render time. (The runtime/GSAP/shader scripts are the only network fetches by design.)
- **Watch for injected loader cruft.** If assets are fetched through a proxy/CDN that injects its own beacon scripts (e.g. a Cloudflare `cdn-cgi/challenge-platform` snippet), strip them — they 404 in the renderer and add noise.
- **No placeholder assets** (`placehold.co`, lorem-ipsum). Ship real brand content.
- **Preserve substance; adapt form.** A composition is a *rebuild* of the design into a timed video, so the FORM changes: a static page becomes multi-scene motion, page nav/footer chrome is dropped or folded in, and a single hero may expand into a short narrative arc. But the brand's SUBSTANCE must survive verbatim: the real headline and copy, the exact palette and fonts, named products and features, real metrics and data points, and signature visual elements (a chart, a waveform, a product shot). Keep distinctive specifics *specific*: do NOT genericize them into vague phrases (e.g. turning a real metric like `2.4M signals/sec` into "streaming now", or a named feature into a generic label), and do NOT invent copy or numbers the brand never provided. When you expand a hero into extra scenes, build them only from the brand's own language and facts.

---

## Building the composition

### 1. Choose dimensions and scene count by video type

| Type | Dimensions | Duration | Scenes |
| --- | --- | --- | --- |
| Social reel | 1080×1920 (9:16) | 10-15s | 5-7 |
| Launch teaser / stat reel | 1920×1080 (16:9) | 8-25s | 5-10 |
| Product explainer | 1920×1080 (16:9) | 30-60s | 10-18 |
| Cinematic title | 1920×1080 (16:9) | 45-90s | 7-12 |

### 2. Fill brand identity on `:root`, and avoid the monoculture

```css
:root {
  --bg: #0a0a0d;
  --ink: #f5f5f7;
  --accent: #7c6cff;
  --muted: #5a6270;
  --font-display: "TT Norms Pro", sans-serif; /* inline via @font-face above */
}
```

- **Banned defaults:** Inter, Inter Tight, Roboto, Open Sans, Noto Sans, Lato, Poppins, Outfit, Sora, Fraunces, Playfair Display, Cormorant Garamond, EB Garamond, Syne, Cinzel, Prata, Bodoni Moda, Nunito, Source Sans, PT Sans, Arimo.
- **Banned pairings:** Fraunces + JetBrains Mono, Inter + anything, Playfair + Lato.
- **Question these:** gradient text, cyan-on-dark, pure `#000`/`#fff`, identical card grids, left-edge accent stripes, everything centered with equal weight.
- Use dramatic weight contrast (300 vs 900). Minimum sizes: 60px+ headlines, 20px+ body, 16px+ labels. Put `font-variant-numeric: tabular-nums` on number columns.

### 3. Fill each scene — content, entrance, mid-scene activity

Put content inside the `.scene-content` wrapper; keep decoratives (glow, grain) outside it, directly in the scene div.

- **Entrance:** one `tl.from()` per element, animating FROM offscreen/invisible TO the CSS position. Offset the first tween 0.1–0.3s into the scene (zero-delay entrances feel like jump cuts).
- **Mid-scene activity (this is what separates video from slides):** every visible element must keep moving after its entrance. Use ≥2 patterns from the catalog below per scene. A still element on a still background is a JPEG with a progress bar.
- **Vary eases** — use ≥3 per scene: `power2.out` (smooth), `power4.out` (snappy), `back.out(1.6)` (bouncy), `expo.out` (dramatic), `sine.inOut` (dreamy).

**Scene duration budget** (reading time drives it; the last readable element must finish entering by 50% of the scene):

| Display text | Min duration |
| --- | --- |
| No text (hero, icon) | 1.5-2s |
| 1-3 words (kicker, number) | 2-3s |
| 4-10 words (headline + subhead) | 3-4s |
| 11-20 words | 4-6s |
| 21-35 words | 6-8s |
| 35+ words | split into two scenes |

Hard ceiling 5s/scene unless you have a specific reason. When you change a `data-duration`, update `data-start` on later scenes and the root's `data-duration` so everything stays tiled.

### 4. Transitions — mostly hard cuts, at most one shader moment for a first draft

~95% of professional scene changes are hard cuts (no transition code — the new scene's entrance does the work). Reserve a shader transition for a single hero reveal, energy shift, or CTA. A shader on every cut is like bolding every word.

**For a Send-to first draft, use at most ONE contiguous shader chain.** The simplest is a single anchor pair — 2 scenes, 1 transition (e.g. `["s4","s5"]`), which is one boundary. A longer *contiguous* chain like s3→s4→s5 is also fine — 3 scenes, 2 transitions (two adjacent boundaries). A single `HyperShader.init()` takes one `scenes` array whose *adjacent* entries each get a transition, so a contiguous chain of N anchors has N-1 transitions (`scenes.length === transitions.length + 1`). **Two disjoint shader moments (e.g. s2→s3 AND s6→s7) are not one contiguous chain and do NOT fit a single init** — that needs care the importer/renderer won't forgive if you get it wrong. Keep to one contiguous chain here; additional shader moments are better added later in the enhance step.

Shader names to pick from: `domain-warp`, `ridged-burn`, `whip-pan`, `sdf-iris`, `ripple-waves`, `gravitational-lens`, `cinematic-zoom`, `chromatic-split`, `swirl-vortex`, `thermal-distortion`, `flash-through-white`, `cross-warp-morph`, `light-leak`, `glitch`. Match energy: calm → `cross-warp-morph`/`light-leak`; professional → `cinematic-zoom`/`whip-pan`/`sdf-iris`; aggressive → `glitch`/`chromatic-split`; ethereal → `gravitational-lens`/`ripple-waves`. Minimum transition duration 0.3s; sweet spot 0.5s. Transition `time = scene_boundary - (duration / 2)`.

**The two bugs that cause "invisible middle scenes" — you must handle both:**

1. **Non-anchor scenes** (not bracketing a shader) use `style="visibility:hidden;"` and need explicit `tl.set` toggles with **`autoAlpha`** (not `visibility`): `autoAlpha:1` at the scene's start, `autoAlpha:0` at its end. Scene 1 starts visible (no inline style) and only gets a hide at its end.
2. **The first anchor scene** in each shader group uses `style="opacity:0;"` and needs `tl.set("#sN", { opacity: 1 }, <start-time>)` — HyperShader does not auto-show it.

**Why `autoAlpha`, not `visibility`:** when a shader fires, HyperShader blanks all `.scene` elements to `opacity:0`. A `visibility`-only toggle leaves the scene `visible` but `opacity:0` (invisible). `autoAlpha` sets both, overriding the reset. Anchor scenes get **no `autoAlpha` toggles** — HyperShader owns their opacity. The **only** timeline write allowed on an anchor container is the required first-anchor `tl.set("#sN", { opacity: 1 }, <start>)`; do not otherwise `tl.set`/`tl.to` an anchor container. Invariant (per contiguous chain): `scenes.length === transitions.length + 1`.

---

## Complete self-contained skeleton (copy, then fill)

A 1920×1080, 8s, 5-scene launch/stat reel — hard cuts with one shader at the outro reveal. Fonts inlined; runtime from CDN; timeline registered. This is a full, importable composition once you fill the `@font-face` base64, the `:root` identity, and the scene content.

```html
<!doctype html>
<html lang="en" style="overflow:hidden; margin:0">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/@hyperframes/core/dist/hyperframe.runtime.iife.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/@hyperframes/shader-transitions/dist/index.global.js"></script>
    <style>
      /* === FILL: inline your brand font(s) as base64 — one @font-face per weight you use (do NOT use a Google Fonts link) === */
      @font-face {
        font-family: "Brand Display";
        font-weight: 800;
        font-style: normal;
        font-display: block;
        src: url(data:font/otf;base64,PASTE_BASE64_800_HERE) format("opentype");
      }
      @font-face {
        font-family: "Brand Display";
        font-weight: 500;
        font-style: normal;
        font-display: block;
        src: url(data:font/otf;base64,PASTE_BASE64_500_HERE) format("opentype");
      }

      :root {
        /* === FILL: brand identity === */
        --bg: #0a0a0d;
        --ink: #ffffff;
        --accent: #7c6cff;
        --muted: rgba(255, 255, 255, 0.55);
        --font-display: "Brand Display", system-ui, sans-serif;
      }

      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 1920px; height: 1080px; overflow: hidden; background: var(--bg); color: var(--ink); }

      .scene { position: absolute; top: 0; left: 0; width: 1920px; height: 1080px; overflow: hidden; }
      .scene-content {
        width: 100%; height: 100%; display: flex; flex-direction: column;
        justify-content: center; align-items: center; gap: 16px; position: relative; z-index: 1;
      }
      .display { font-family: var(--font-display); font-weight: 800; line-height: 1.05; }
      .stat { font-family: var(--font-display); font-weight: 800; font-size: 300px; font-variant-numeric: tabular-nums; }
      .label { font-family: var(--font-display); font-weight: 500; font-size: 40px; letter-spacing: 0.25em; text-transform: uppercase; color: var(--muted); }

      /* === FILL: per-scene styles === */
    </style>
  </head>
  <body>
    <div id="main" data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="8">
      <!-- SCENE 1 (0-1.6s) — intro; visible from t=0, non-anchor -->
      <div class="scene clip" id="s1" data-start="0" data-duration="1.6" data-track-index="0">
        <div class="scene-content">
          <h1 id="s1-word" class="display" style="font-size:280px;">Brand</h1>
          <p id="s1-sub" class="label">Your tagline</p>
        </div>
      </div>

      <!-- SCENE 2 (1.6-3.2s) — stat, non-anchor -->
      <div class="scene clip" id="s2" data-start="1.6" data-duration="1.6" data-track-index="0" style="visibility:hidden;">
        <div class="scene-content">
          <div id="s2-stat" class="stat">0</div>
          <div id="s2-label" class="label">Metric one</div>
        </div>
      </div>

      <!-- SCENE 3 (3.2-4.8s) — stat, non-anchor -->
      <div class="scene clip" id="s3" data-start="3.2" data-duration="1.6" data-track-index="0" style="visibility:hidden;">
        <div class="scene-content">
          <div id="s3-stat" class="stat">0</div>
          <div id="s3-label" class="label">Metric two</div>
        </div>
      </div>

      <!-- SCENE 4 (4.8-6.4s) — stat, SHADER ANCHOR (first anchor: opacity:0) -->
      <div class="scene clip" id="s4" data-start="4.8" data-duration="1.6" data-track-index="0" style="opacity:0;">
        <div class="scene-content">
          <div id="s4-stat" class="stat">0</div>
          <div id="s4-label" class="label">Metric three</div>
        </div>
      </div>

      <!-- SCENE 5 (6.4-8.0s) — outro, SHADER ANCHOR (HyperShader manages opacity) -->
      <div class="scene clip" id="s5" data-start="6.4" data-duration="1.6" data-track-index="0" style="opacity:0;">
        <div class="scene-content">
          <h2 id="s5-l1" class="display" style="font-size:120px;">Closing line,</h2>
          <h2 id="s5-l2" class="display" style="font-size:120px; font-style:italic; font-weight:500;">not another.</h2>
        </div>
      </div>
    </div>

    <script>
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });

      // --- Visibility toggles: non-anchor scenes use autoAlpha; first anchor gets an explicit show ---
      tl.set("#s1", { autoAlpha: 0 }, 1.6);              // s1 starts visible; hide at its end
      tl.set("#s2", { autoAlpha: 1 }, 1.6); tl.set("#s2", { autoAlpha: 0 }, 3.2);
      tl.set("#s3", { autoAlpha: 1 }, 3.2); tl.set("#s3", { autoAlpha: 0 }, 4.8);
      tl.set("#s4", { opacity: 1 }, 4.8);                // first shader anchor must be explicitly shown
      // s5 is the second anchor — HyperShader manages its opacity.

      // === SCENE 1 (0-1.6) — intro ===
      tl.from("#s1-word", { yPercent: 120, autoAlpha: 0, duration: 0.6, ease: "power3.out" }, 0.1);
      tl.from("#s1-sub", { autoAlpha: 0, y: 20, duration: 0.5, ease: "power2.out" }, 0.5);

      // === SCENE 2 (1.6-3.2) — count-up stat (see Counter pattern) ===
      tl.from("#s2-stat", { yPercent: 70, autoAlpha: 0, duration: 0.5, ease: "power3.out" }, 1.7);
      tl.from("#s2-label", { x: -30, autoAlpha: 0, duration: 0.5, ease: "power2.out" }, 1.9);
      var c2 = { v: 0 };
      tl.to(c2, { v: 10000, duration: 0.9, ease: "power2.out",
        onUpdate: function () { document.getElementById("s2-stat").textContent = Math.round(c2.v).toLocaleString("en-US"); } }, 1.7);

      // === SCENE 3 (3.2-4.8) ===
      tl.from("#s3-stat", { yPercent: 70, autoAlpha: 0, duration: 0.5, ease: "power3.out" }, 3.3);
      tl.from("#s3-label", { x: -30, autoAlpha: 0, duration: 0.5, ease: "power2.out" }, 3.5);
      var c3 = { v: 0 };
      tl.to(c3, { v: 48, duration: 0.85, ease: "power2.out",
        onUpdate: function () { document.getElementById("s3-stat").textContent = Math.round(c3.v); } }, 3.3);

      // === SCENE 4 (4.8-6.4) — shader anchor, NO exit tweens ===
      tl.from("#s4-stat", { yPercent: 70, autoAlpha: 0, duration: 0.5, ease: "power3.out" }, 4.9);
      tl.from("#s4-label", { x: -30, autoAlpha: 0, duration: 0.5, ease: "power2.out" }, 5.1);
      var c4 = { v: 0 };
      tl.to(c4, { v: 5, duration: 0.8, ease: "power2.out",
        onUpdate: function () { document.getElementById("s4-stat").textContent = Math.round(c4.v) + " min"; } }, 4.9);

      // === SCENE 5 (6.4-8.0) — outro, final scene ===
      tl.from("#s5-l1", { autoAlpha: 0, y: 30, duration: 0.5, ease: "power3.out" }, 6.5);
      tl.from("#s5-l2", { autoAlpha: 0, y: 30, duration: 0.5, ease: "power3.out" }, 6.75);

      // --- One shader transition at the outro reveal (s4 -> s5) ---
      window.HyperShader.init({
        bgColor: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#0a0a0d",
        scenes: ["s4", "s5"],
        timeline: tl,
        transitions: [{ time: 6.15, shader: "cinematic-zoom", duration: 0.5 }],
      });

      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
```

---

## Animation pattern catalog (copy-paste)

**The last argument of every `tl.to`/`tl.from` is the ABSOLUTE start time on the timeline (in seconds).** These snippets use a `SCENE_START` placeholder — replace it (and every selector) with your scene's real `data-start`, and keep each tween's **full active span** inside its scene window: `start + total_duration ≤ SCENE_START + data-duration`, where `total_duration` accounts for `repeat`, `yoyo` (each yoyo cycle doubles it), `repeatDelay`, and `stagger` spread. Do not paste the placeholder numbers literally.

**Counter** — animate a number up (see the skeleton's `c2/c3/c4`):
```js
var c = { v: 0 };
tl.to(c, { v: 1900000000000, duration: 0.9, ease: "power2.out",
  onUpdate: function () { document.getElementById("s3-stat").textContent = "$" + (c.v / 1e12).toFixed(1) + "T"; } }, /* SCENE_START */ 3.3);
```

**Character stagger** — wrap each char in `<span class="char">`, then:
```js
tl.from(".char", { y: 60, autoAlpha: 0, duration: 0.5, ease: "power3.out", stagger: { each: 0.12, from: "start" } }, /* SCENE_START + 0.1 */ 0.1);
```

**Bar-chart fill:**
```js
["#bar1", "#bar2", "#bar3", "#bar4"].forEach(function (sel, i) {
  tl.from(sel, { scaleY: 0, transformOrigin: "bottom", duration: 0.6, ease: "expo.out" }, /* SCENE_START */ 3.3 + i * 0.15);
});
```

**Breathing float (mid-scene activity)** — note the yoyo+repeat doubles the span (0.6 × 2 = 1.2s), so from 4.9 it ends at 6.1, inside s4's 4.8-6.4 window:
```js
tl.to("#s4-logo", { y: -5, duration: 0.6, ease: "sine.inOut", yoyo: true, repeat: 1 }, /* SCENE_START */ 4.9);
```

**SVG stroke draw** — `stroke-dasharray="440" stroke-dashoffset="440"` on the path, then:
```js
tl.to("#s2-line", { strokeDashoffset: 0, duration: 1.0, ease: "power2.out" }, /* SCENE_START */ 1.7);
```

**Highlight sweep** — `background: linear-gradient(var(--accent),var(--accent)) no-repeat 0 85% / 0% 30%;`, then:
```js
tl.to("#s5-headline", { backgroundSize: "100% 30%", duration: 0.6, ease: "power2.out" }, /* SCENE_START */ 6.6);
```

**CSS grain** (never SVG-filter grain — it taints html2canvas and breaks shaders in a cross-origin iframe):
```css
.grain { position:absolute; inset:0; pointer-events:none; z-index:50; opacity:0.18; mix-blend-mode:overlay;
  background-image: radial-gradient(rgba(255,255,255,.08) 1px, transparent 1.2px), radial-gradient(rgba(0,0,0,.18) 1px, transparent 1.2px);
  background-size: 3px 3px, 5px 5px; background-position: 0 0, 1px 2px; }
```

---

## Determinism & media rules (universal — violating these renders wrong or blank)

The cloud renderer seeks the timeline frame-by-frame. Non-deterministic or self-driven animation fails.

| Never | Use instead |
| --- | --- |
| `Math.random()` | seeded PRNG (only if truly needed) |
| `Date.now()`, `performance.now()` | hard-coded timing or `tl.time()` in `onUpdate` |
| `setInterval`, `setTimeout` | timeline tweens + `onUpdate` |
| `requestAnimationFrame` | GSAP tweens |
| `repeat: -1` | `repeat: Math.max(0, Math.floor(duration / cycle) - 1)` |
| `stagger: { from: "random" }` | `from: "start"`, `"center"`, or `"end"` |
| async timeline construction | build synchronously at page load |
| `video.play()` / `audio.play()` | the framework owns playback |
| `<video>` without `muted playsinline` | always `muted playsinline`; audio on a separate `<audio>` |
| exit tweens before a shader | the shader IS the exit — content stays visible |
| `tl.set`/`tl.to` on an anchor container (beyond the required first-anchor `opacity:1` set) | HyperShader owns anchor opacity; only `tl.set(firstAnchor, { opacity: 1 }, start)` is allowed |
| `autoAlpha` on an anchor scene | anchors use `opacity` (HyperShader-managed); `autoAlpha` is for non-anchor scenes |
| animating `visibility`/`display` | use `autoAlpha` (non-anchor scenes only) |
| SVG-filter `data:image/svg+xml` grain | CSS radial-gradient grain (above) |

Note: this is the one place the download-ZIP guidance is **reversed** — for Send-to, base64 `data:` URIs for fonts/images are **required**, not banned.

---

## Keep the original design as a reference

A composition is a *rebuild* of your design into a timed video, so it adapts the **form** (see *Preserve substance; adapt form* above), but it should never lose the brand's substance. Preserve the original design **as a separate reference** (not as the composition that drives the video) so a later agent can pull back any distinctive content or styling the rebuild dropped despite that rule. This turns a first draft into a fixable one rather than a dead end.

---

## What "enhance" adds after import (in-flight — intent, not a stable contract)

Your export is **silent** and visual-only. Sending it to HyperFrames levels it up with things Claude Design can't add:

- **Sound** — background music and sound effects timed to the animation (the immediate win).
- **Motion polish** — easing, timing, transition refinement via a purpose-built motion-design agent.
- **HeyGen media (later)** — images/icons, and eventually avatars/voice.

You don't author any of this. Produce a clean, on-brand, correctly-timed silent composition; the enhance step does the rest.

---

## Self-review checklist (run before "Send to HyperFrames")

**Import will accept it:**
- [ ] Exactly one live root with `data-composition-id="main"`, **not** inside a `<template>`
- [ ] Numeric `data-width` / `data-height` / `data-duration` on the root
- [ ] Every scene has numeric `data-start` + `data-duration`; scenes tile with no gaps
- [ ] `window.__timelines["main"] = tl` present and keyed to the composition id
- [ ] **Not** a bundled/splash-loader artifact (no `<template>` splash, no base64 asset manifest, no `window.__resources`)

**Fidelity survives the single-file trip:**
- [ ] Every brand font inlined as a base64 `@font-face` src (no Google Fonts `<link>`)
- [ ] Every image/logo inlined as a base64 `data:` URI — no external/relative URL
- [ ] No `s3://` / presigned / private / expiring asset URLs
- [ ] No injected beacon/loader cruft (e.g. Cloudflare `cdn-cgi` scripts)
- [ ] Original design preserved as a separate reference

**Structural validity (the renderer can't fix these):**
- [ ] Every scene has `class="scene clip"` + a `.scene-content` wrapper
- [ ] Non-anchor scenes: `visibility:hidden` + `autoAlpha` set/reset toggles; anchor scenes: `opacity:0`, first anchor explicitly shown
- [ ] `scenes.length === transitions.length + 1`; each shader boundary sits inside its window; no transition < 0.3s
- [ ] No exit tweens except on the final scene

**Renders correctly:**
- [ ] No `Date.now()`, unseeded `Math.random()`, `setInterval/Timeout`, `requestAnimationFrame`, `repeat: -1`
- [ ] Timeline built synchronously; paused; framework owns playback
- [ ] Colors and fonts exact; brand substance preserved: real headline/copy, distinctive figures/stats/data points, product names, and signature visuals carried over verbatim (form adapted, never genericized or invented); no placeholders; ≥2 animation patterns + mid-scene activity per scene
