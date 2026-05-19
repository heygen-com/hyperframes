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
  data-duration="6"
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

```css
.scene {
  position: relative;
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  background: #05060d;
  font-family: "JetBrains Mono", monospace;
}
.terminal {
  display: flex;
  align-items: baseline;
  gap: 24px;
  font-size: 72px;
  font-weight: 800;
  color: #f5f6fb;
  white-space: pre;
}
.prompt {
  color: #a78bfa;
}
.text-wrap {
  display: inline-flex;
  align-items: baseline;
  min-width: 1200px;
}
.text {
  color: #f5f6fb;
  white-space: pre;
}
/* Cursor highlights based on active segment via class swap */
.cursor {
  display: inline-block;
  width: 20px;
  height: 64px;
  background: #f5f6fb; /* default */
  margin-left: 6px;
  vertical-align: -8px;
}
```

## GSAP Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  // Sequence with per-entry segment label.
  // Cursor color shifts as segment changes — viewer's eye locks onto the typed brand.
  const SEQUENCE = [
    { t: 0.0, text: "", segment: "main", color: "#f5f6fb" },
    { t: 0.4, text: "bunx ", segment: "main", color: "#f5f6fb" },
    { t: 0.8, text: "bunx h", segment: "brand", color: "#a78bfa" }, // brand segment starts
    { t: 1.1, text: "bunx hy", segment: "brand", color: "#a78bfa" },
    { t: 1.4, text: "bunx hyperframes", segment: "brand", color: "#a78bfa" },
    { t: 1.7, text: "bunx hyperframes ", segment: "main", color: "#f5f6fb" }, // back to main
    { t: 2.0, text: "bunx hyperframes render", segment: "cmd", color: "#34d399" }, // command segment (green)
    { t: 2.4, text: "bunx hyperframes render --out=", segment: "cmd", color: "#34d399" },
    {
      t: 2.9,
      text: "bunx hyperframes render --out=heygenverse.mp4",
      segment: "brand",
      color: "#a78bfa",
    }, // brand again
    {
      t: 4.2,
      text: "bunx hyperframes render --out=heygenverse.mp4 ✓",
      segment: "success",
      color: "#34d399",
    }, // success
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
      t: 6.0,
      duration: 6.0,
      ease: "none",
      onUpdate: () => {
        const entry = entryAt(driver.t);
        textEl.textContent = entry.text;
        cursorEl.style.background = entry.color;
      },
    },
    0,
  );

  // Deterministic blink via sin (NOT CSS animation)
  const blink = { p: 0 };
  tl.to(
    blink,
    {
      p: Math.PI * 2 * 8,
      duration: 6.0,
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

When letters are being added (driver moved forward in the last 0.2s), suppress blink — cursor stays solid. When no typing activity (`time - lastChangeTime > 0.2s`), resume blink.

```js
let lastChangeTime = 0,
  lastText = "";
// In onUpdate:
if (entry.text !== lastText) {
  lastChangeTime = driver.t;
  lastText = entry.text;
}
const isTyping = driver.t - lastChangeTime < 0.2;
cursorEl.style.opacity = isTyping ? "1" : Math.sin(blink.p) > 0 ? "1" : "0";
```

### Cursor HEIGHT shifts on segment

Larger cursor on brand segment for emphasis:

```js
cursorEl.style.height = entry.segment === "brand" ? "76px" : "64px";
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

- `/hyperframes-gsap` — onUpdate driving cursor color + sin blink
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
