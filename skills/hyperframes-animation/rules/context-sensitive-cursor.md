---
name: context-sensitive-cursor
description: Cursor color and styling that adapt to the current text segment being typed — accent color on highlights, dim on placeholders, etc.
metadata:
  tags: cursor, color, context, typewriter, styling, segment
---

# Context-Sensitive Cursor

In a typewriter sequence, the cursor's color (and optionally height/blink rate) matches the **active text segment**. If the typewriter is currently typing a brand name, the cursor is the brand accent color; on a placeholder, it dims to gray. Enhances visual cohesion vs a single fixed cursor color across all text states.

## How It Works

The text is authored as a SEQUENCE of `{text, t, segment}` entries where `segment` is a string identifier ('main' / 'highlight' / 'brand' / 'success'). The driver tween's onUpdate determines the current segment based on `time`, then sets the cursor's CSS color (and optionally other props) to match that segment's palette.

## HTML

```html
<div
  class="scene"
  id="cursor-scene"
  data-composition-id="cursor-scene"
  data-start="0"
  data-duration="{DURATION}"
  data-track-index="0"
>
  <div class="terminal">
    <div class="prompt">$</div>
    <div class="text-wrap">
      <span class="text" id="text"></span><span class="cursor" id="cursor">_</span>
    </div>
  </div>
</div>
```

## CSS

Placeholders: `{monoFont}` is the project's monospace stack (proportional fonts cause cursor drift mid-segment); `{bgColor}` is the dark backdrop; `{textColor}` is the readable foreground; `{promptColor}` is the segment-default color for the leading prompt glyph.

```css
.scene {
  position: relative;
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  background: {bgColor};
  font-family: {monoFont};
}
.terminal {
  display: flex;
  align-items: baseline;
  gap: 24px;
  font-size: 72px;
  font-weight: 800;
  color: {textColor};
  white-space: pre;
}
.prompt {
  color: {promptColor};
}
.text-wrap {
  display: inline-flex;
  align-items: baseline;
  min-width: 1200px;
}
.text {
  color: {textColor};
  white-space: pre;
}
/* Cursor highlights based on active segment via per-frame background swap */
.cursor {
  display: inline-block;
  width: {cursorWidth}px;
  height: {cursorHeight}px;
  background: {textColor}; /* default — overridden per segment in onUpdate */
  margin-left: {cursorGap}px;
  vertical-align: {cursorBaselineFix}px;
}
```

## GSAP Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  // Sequence with per-entry segment label.
  // Each entry: { t: absoluteSeconds, text: cumulative visible string, segment: paletteKey, color: hex }.
  // As the driver crosses each `t`, the cursor color swaps to that segment's accent —
  // viewer's eye locks onto the keyword being typed.
  // Shape: a monotonic timeline of N entries where adjacent entries usually share text-prefix
  // but may differ in `segment` (which is what makes the cursor color shift mid-line).
  const SEQUENCE = [
    { t: 0, text: "", segment: "main", color: "{mainColor}" },
    { t: T_LEADIN_END, text: "{leadInChunk}", segment: "main", color: "{mainColor}" },
    { t: T_BRAND_IN, text: "{leadInBrandPrefix}", segment: "brand", color: "{brandColor}" }, // brand segment starts
    { t: T_BRAND_OUT, text: "{leadInBrandFull}", segment: "main", color: "{mainColor}" }, // back to main
    { t: T_CMD_IN, text: "{leadInCmdPrefix}", segment: "cmd", color: "{cmdColor}" }, // command segment
    { t: T_BRAND_2, text: "{leadInCmdBrand}", segment: "brand", color: "{brandColor}" }, // brand again (e.g. filename)
    { t: T_SUCCESS, text: "{leadInDone}", segment: "success", color: "{successColor}" }, // completion mark
  ];

  function entryAt(time) {
    for (let i = SEQUENCE.length - 1; i >= 0; i--) {
      if (time >= SEQUENCE[i].t) return SEQUENCE[i];
    }
    return SEQUENCE[0];
  }

  const textEl = document.getElementById("text");
  const cursorEl = document.getElementById("cursor");

  // Discrete state driver — writes text + cursor color
  const driver = { t: 0 };
  tl.to(
    driver,
    {
      t: DURATION,
      duration: DURATION,
      ease: "none",
      onUpdate: () => {
        const entry = entryAt(driver.t);
        textEl.textContent = entry.text;
        cursorEl.style.background = entry.color;
      },
    },
    0,
  );

  // Deterministic blink via sin (NOT CSS animation).
  // Phase sweep = (2π) × BLINK_CYCLES_PER_SCENE drives a square wave at sign(sin(p)).
  const blink = { p: 0 };
  tl.to(
    blink,
    {
      p: Math.PI * 2 * BLINK_CYCLES_PER_SCENE,
      duration: DURATION,
      ease: "none",
      onUpdate: () => {
        cursorEl.style.opacity = Math.sin(blink.p) > 0 ? "1" : "0";
      },
    },
    0,
  );

  window.__timelines["cursor-scene"] = tl;
</script>
```

## Variations

### Non-blinking during active typing

When letters are being added (driver moved forward in the last `TYPING_GRACE` seconds), suppress blink — cursor stays solid. When no typing activity (`driver.t - lastChangeTime > TYPING_GRACE`), resume blink.

```js
let lastChangeTime = 0,
  lastText = "";
// In onUpdate:
if (entry.text !== lastText) {
  lastChangeTime = driver.t;
  lastText = entry.text;
}
const isTyping = driver.t - lastChangeTime < TYPING_GRACE;
cursorEl.style.opacity = isTyping ? "1" : Math.sin(blink.p) > 0 ? "1" : "0";
```

### Cursor HEIGHT shifts on segment

Larger cursor on brand segment for emphasis (`cursorHeightEmphasis > cursorHeight`):

```js
cursorEl.style.height =
  entry.segment === "brand" ? `${cursorHeightEmphasis}px` : `${cursorHeight}px`;
```

### Cursor reverses contrast on dark text

If a segment is rendered DARK text on light bg, cursor should swap to dark too. Manage via `entry.color` as the SOURCE OF TRUTH and read from there.

## Key Principles

- **Cursor color shifts make brand moments POP** — eye lands on the brand name because the cursor color shifts to brand accent. Without it, cursor is visual noise.
- **`background` property on the cursor div** — NOT `color` (cursor is a colored block, not a glyph)
- **Deterministic blink via sin** — never CSS `@keyframes blink`. HF seek will desync.
- **Cursor `display: inline-block`** — `display: inline` ignores width/height.
- **`vertical-align: -8px`** (or similar) — visually anchor cursor to text baseline, not full line-height.
- **`white-space: pre`** on text and parent — preserve trailing spaces so cursor sits at end of segment, not after collapsed space.
- **Color palette aligned with brand system** — 3-4 colors max for segments (main / brand / cmd / success). More and the segmentation reads as random.

## How to Choose Values

- **DURATION** — total scene length in seconds
  - Range: 4-8 s for a single typed line; longer if the line is long
  - Effects: too short truncates the typing; too long leaves a dead tail after the success state
  - Constraints: must be `≥ SEQUENCE[last].t + (closing dwell)`
  - Reference: see the corresponding blueprint's example HTML

- **SEQUENCE entry `t` values** — absolute seconds where each new visible text + segment kicks in
  - Range: monotonically increasing; spacing 0.2-0.5 s between micro-additions (per-word or per-token), longer between segment swaps
  - Effects: too-tight spacing collapses the typing feel into a slideshow; too-loose drags
  - Constraints: ordered ascending; entries do not need uniform spacing — slow down on highlights
  - Reference: see the corresponding blueprint's example HTML

- **Segment palette: mainColor / brandColor / cmdColor / successColor** — the cursor-fill swatches
  - Range: 3-4 discrete colors max; each should be distinguishable at small cursor width
  - Effects: too many segments and the swaps read as random; too few and the brand moment loses pop
  - Constraints: `brandColor` and `successColor` may be similar in hue but should differ in saturation/luminance so a brand→success transition is visible
  - Reference: see the corresponding blueprint's example HTML

- **cursorWidth / cursorHeight / cursorGap / cursorBaselineFix** — cursor block geometry
  - Range: cursorWidth 8-24 px; cursorHeight ≈ 0.85-1.0 × fontSize; cursorGap 4-12 px; cursorBaselineFix small negative number to drop below the baseline
  - Effects: too-thin cursor disappears in render compression; too-tall cursor visually outranks the text
  - Constraints: must use `display: inline-block` (a `width` on `display: inline` is ignored)
  - Reference: see the corresponding blueprint's example HTML

- **cursorHeightEmphasis** (Variations) — height when the active segment is the brand
  - Range: 1.1-1.25 × `cursorHeight`
  - Effects: subtle bump reads as emphasis; large bump reads as glitch
  - Constraints: `cursorHeightEmphasis > cursorHeight`
  - Reference: see the corresponding blueprint's example HTML

- **BLINK_CYCLES_PER_SCENE** — how many full blink cycles span `DURATION`
  - Range: choose so the period `DURATION / BLINK_CYCLES_PER_SCENE` ≈ 0.6-1.2 s; e.g. an 8-second scene with ~1 s period uses BLINK_CYCLES_PER_SCENE = 8
  - Effects: short period (many cycles) reads as glitchy / agitated; long period reads as terminal-idle
  - Constraints: must be a whole number when `DURATION` is fixed — the sin sweep ends mid-cycle otherwise and the cursor pops on the last frame
  - Reference: see the corresponding blueprint's example HTML

- **TYPING_GRACE** (Variations) — seconds after a text change during which blink is suppressed
  - Range: 0.15-0.3 s
  - Effects: low end still blinks while letters are still appearing; high end keeps cursor solid through long holds
  - Constraints: must be smaller than the shortest dwell between two adjacent SEQUENCE entries — otherwise the cursor never blinks
  - Reference: see the corresponding blueprint's example HTML

## Critical Constraints

- **Timeline must be paused**: `gsap.timeline({ paused: true })`
- **Registry key = `data-composition-id`**
- **No CSS animation** on cursor — must be timeline-driven (blink + color)
- **Cursor `display: inline-block`** — required for width/height
- **`white-space: pre`** on text container and text — preserve trailing space
- **Monospace font** — proportional fonts cause cursor to drift mid-segment

## Combinations

- [discrete-text-sequence.md](discrete-text-sequence.md) — uses the same SEQUENCE array pattern; this rule adds the cursor styling layer
- [camera-cursor-tracking.md](camera-cursor-tracking.md) — camera tracks the cursor across the typing
- [press-release-spring.md](press-release-spring.md) — after typing completes, a button press confirms the command

## Pairs with HF skills

- `/hyperframes-animation` — onUpdate driving cursor color + sin blink
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
