---
name: vox-explainer
description: >
  A Vox-style editorial explainer built natively in HyperFrames. Five page
  grammars keyed to topic — collage (culture), diagram (tech/product),
  dark-data (data/finance), archive (history), atlas (geopolitics) — sharing
  one annotation philosophy: chips, thin arrows, highlighter words, numbered
  steps, source footnotes. Image assets come from image generation (NB2L) or
  media-use; layout, text, motion and charts are HF-native (deterministic, HD,
  text-perfect). Up to ~60s narrated. For a talking-head / avatar host
  variant → /vox-avatar. Unclear intent → /hyperframes.
---

# vox-explainer — Vox editorial explainer (five page grammars)

> **v2** (2026-07-16, frame-level dissection of 4 canonical Vox videos — taxonomy in
> `references-vox-grammar.md` §grammars). v1 (collage-only) preserved at git tag `vox-skills-v1`.

> **The front door is `/hyperframes`.** This workflow is autonomous by design: at most one
> clarifying question, then build through verification. Rendering is user-gated — after
> `lint` + `check` pass, **stop and offer preview first** (canonical preview-or-render gate).

Verified provenance (VA-1766): style grammar from Ori Silver V1 frame dissection + Hongbin's
Omni collage prompt + gpt-5-pro synthesis (`references-vox-grammar.md`); HF-native beat verified
at $0.03/beat vs $1.01/beat for pure Omni generation, with 100% text correctness.

## Workflow

All artifacts in `videos/<project>/`. Phases: **grammar → beats → assets → compose → verify → (gate) preview/render**.

### 0. Pick the page grammar (one per piece — this is the biggest quality lever)

"Vox style" is not one look; it is a FAMILY of SIX page grammars sharing an annotation philosophy.
Pick by topic, before writing beats:

| Grammar | Preset | Topic fit | Page basis |
|---|---|---|---|
| collage | `presets/collage-zine.md` / `presets/paper-craft.md` | culture, narrative history | kraft/cream paper, torn cutouts, tape |
| diagram | `presets/diagram.md` | tech, product, how-it-works | paper-white, outline line-art, thin arrows |
| dark-data | `presets/dark-data.md` | data, finance, investigation | charcoal, annotated charts, social cards |
| archive | `presets/archive.md` | history, war, biography | near-black desk, floating photo cards |
| atlas | `presets/atlas.md` | geopolitics, international | grayscale map, country fills, timeline bar |
| specimen | `presets/specimen.md` | typography, branding, object stories | studio-paper void, everything is a card, print-ink type |

A piece may borrow ONE page from a second grammar (e.g. an archive page inside an atlas piece)
but has a single home grammar. The annotation components (§3) work across all five.

### 1. Beat map (`beats.json`) — the contract

30s piece = 5–6 beats × 4–6s (NOT 10s — that is a video-model cap, not editorial rhythm).
Per beat: `{id, label, vo, visual, camera, transition_out, palette_page}`.

- `label`: 1–3 words ALL-CAPS, keyed to a VO keyword. Labels + VO ARE the format — no
  full-sentence subtitles. One label per tableau.
- `vo`: ~2.2 words/sec budget. Piece structure: cold-open hook (impossible fact / date-place,
  ≤3s) → data anchors (real numbers, real dates) → loop-close or reversal ending.
- `camera`: static | push_in | pull_out | pan | parallax — one move per beat, **never the same
  move on adjacent beats, static reserved for the payoff beat**.
- `transition_out`: hard_cut | whip_pan | paper_slide | page_flip. No dissolves.
- `palette_page`: per-beat page color; run an arc (kraft → deep purple drama → kraft resolution).
- Style words (paper, collage, kraft…) NEVER appear inside `vo` or `label` (style/content
  separation — known failure mode is style vocabulary leaking into rendered copy).

### 2. Assets (image generation; everything else HF-native)

The preset was chosen in §0. Never mix presets in a piece.

- Photo-like cutouts (people, objects, archival): `scripts/nb2l_image.py "<prompt>" out.jpg` —
  prompt pattern: "vintage copper engraving etching of X, deep purple monochrome ink on plain
  white background, no text, no border". Needs `GEMINI_PREFAB_KEY` in env (Infisical:
  experiment-framework/dev; scope generative-language is handled by the script).
- Maps, charts, big type, labels, geometric blocks, tape, textures: **always HF-native**
  (CSS/SVG/GSAP) — never generate images of text or charts.
- BGM/SFX: media-use resolve (paper-rustle, tape-snap accents; duck under VO).

### 2.5 Page variety system (anti-monotony — MANDATORY)

A vox piece is a sequence of DIFFERENT pages, not one page redecorated. Two hard rules:

- **Page arc:** every beat gets its own page treatment; adjacent beats must differ in page
  color OR dominant layout archetype. Run a palette arc across the piece (e.g. kraft setup →
  deep-purple or newsprint drama → cream/minimal resolution — the arc observed in the Ori V1
  reference dissection). A single kraft page reused for every beat reads as monotone (empirical
  review failure, 2026-07-16).
- **Layout archetypes** (pick per beat, never repeat on adjacent beats):
  `hero-center` (one big cutout + label) · `split-page` (color field left, content right) ·
  `full-bleed-chart` (the chart IS the page) · `map-spread` (map as background world) ·
  `type-page` (typographic beat, words as objects) · `archive-desk` (scattered documents/photos)
  · `minimal-payoff` (one element, huge negative space).
- Page textures to rotate: kraft grain · newsprint columns · graph paper · parchment ·
  flat poster color. Texture changes with the arc, not per element.

### 3. Compose (per beat = one `.clip` scene)

**Reusable registry items (prefer these over hand-writing the CSS):**

- Collage family: `npx hyperframes add vox-paper-page vox-torn-card vox-cutout-label vox-tape vox-boil`,
  plus `vox-beat-hero` — a variable-driven hero beat block (label / image_src / page_color /
  accent_color / duration), cloneable per beat so the page arc is a variables change, not a rewrite.
- **Annotation family (grammar-agnostic — use in EVERY piece):**
  `npx hyperframes add vox-thin-arrow vox-caption-chip vox-numbered-step vox-highlighter-word vox-source-footnote`.
  These are the shared Vox annotation philosophy: labels point AT things (thin-arrow), facts get
  factual-register chips (caption-chip, mono variant for archive), processes get numbered steps,
  key words get marker sweeps, and every borrowed image/number gets a source footnote.
- Data family (dark-data / archive grammars): `npx hyperframes add vox-annotated-line-chart vox-pie-callout vox-highlight-row-table` —
  each ships a seek-safe draw-on helper (voxLineDraw / voxPieReveal / voxTableFocus). One chart
  per page; emphasize one series/row in accent, rest neutral; every chart gets a source footnote.
- Continuity: `npx hyperframes add vox-timeline-bar` — persistent bottom timeline (atlas grammar,
  but works for any dated narrative). Mount ONCE at composition level, keep it resident across
  beats, glide the playhead each beat, pop event chips on their VO keywords. Stronger than a
  recurring motif.

Working example with every pattern wired: `patterns/beat-collage-example.html`
(lint+WCAG-clean, rendered). Theme tokens, torn-edge card `clip-path`, tape strips
(`mix-blend-mode: multiply`), cutout label strips, paper grain (`feTurbulence` SVG), fold crease.

Motion patterns (see example for exact tweens):
- sticker-pop entrance `back.out(2)` on a `-wrap` element; tape snap `power4.out` 0.25s;
  label slap `back.out(1.6)` timed to its VO keyword
- stop-motion boil: deterministic `tl.set()` every 1/6s with mulberry32 jitter (±2px, ±0.55°)
  on the INNER element — entrance on wrapper, boil on child, push-in on scene wrapper
  (never stack transforms on one element); **boil never touches text**
- page-flip transition: CSS 3D `rotationY: -178` (never -180), perspective 2400px
- charts: bars `scaleY` draw-on synced to VO; line charts via `stroke-dashoffset` draw;
  emphasize one series in accent, rest neutral; `tabular-nums` on figures
- highlighter sweep for emphasis (marker highlight, see /hyperframes css-patterns)

Layout: hero-frame first, entrances via `fromTo`. Two focal points minimum; three layers
(page / content / accent). VO as `<audio>` clips per beat (TTS via hyperframes-media; at
preview stage a timing placeholder from the 2.2 w/s budget is acceptable).

### 4. Verify → gate

`npx hyperframes lint` + `npx hyperframes check` + label/VO keyword alignment +
adjacent-beat camera check. Then STOP: offer preview (`npx hyperframes preview`) before
any render.

## Grammar reference

`references-vox-grammar.md` — parameter-level style summary (shadows 6–12px/8–16px blur,
labels 3–12 words max on screen, stepped 12–15fps element motion, micro-beats every
0.4–0.8s, chapter shifts 15–30s, hold key charts 2–3s post-VO).
