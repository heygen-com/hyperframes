---
name: context-sensitive-cursor
description: Typing cursor whose color reflects the active text segment — primary while typing the lead-in, accent while typing the highlight. Cursor color + square-wave blink + character slicing all live in one master `onUpdate` reading `tl.time()`.
metadata:
  tags: cursor, color, context, typewriter, styling, gsap
  adapter: gsap
---

# Context-Sensitive Cursor

A typewriter cursor that **changes color** at segment boundaries (e.g. white while typing the neutral lead-in, accent color while typing the emphasized keyword). The color shift is a visual signal that the "emphasis zone" has been entered — much stronger than the same-colored cursor sliding along.

The specific accent color is a per-composition design choice. The examples below use pink (`#FF1E7A`); the [messaging-multi-phrase.html](../examples/messaging-multi-phrase.html) example uses cyan (`#32FFF6`). Pick whichever matches the brand or scene palette — the pattern is identical.

## HyperFrames vs. Remotion

The Remotion version computed `cursorColor` in the render loop and used `frame % blinkCycle` for the blink, both inside a React component that re-rendered every frame.

```tsx
const charIndex = Math.floor(activeFrame / speed);
const visibleMain = textMain.slice(0, charIndex);
const isTypingAccent = visibleMain.length === textMain.length && visibleAccent.length > 0;
const cursorColor = isTypingAccent ? accentColor : mainColor;
const opacity = frame % blinkCycle < blinkCycle / 2 ? 1 : 0;
```

HyperFrames has no per-frame render. All three concerns — character slicing, color switching, blink — fold into one GSAP `onUpdate` that reads `tl.time()`:

| Concern             | HyperFrames mechanism                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| Character slicing   | `charIdx = Math.floor((tl.time() - phraseStart) / charSpeed)` inside `onUpdate`                   |
| Cursor color        | `cursorEl.style.background = inAccent ? ACCENT : MAIN` in the same onUpdate                       |
| Blink (square wave) | `(tl.time() % BLINK_CYCLE) < BLINK_CYCLE / 2 ? "1" : "0"` — modulo gives the square wave for free |

No conditional rendering, no React hooks — just one `onUpdate` writing to three DOM properties.

## Element HTML

```html
<div class="type-line">
  <span class="type-main"></span><span class="type-accent"></span><span class="type-cursor"></span>
</div>
```

```css
.type-line {
  display: flex;
  align-items: center;
  justify-content: center;
  white-space: pre; /* preserves trailing space in textMain */
  font:
    600 100px/1 "Inter",
    system-ui,
    sans-serif;
}
.type-main {
  color: #ffffff;
}
.type-accent {
  color: #ff1e7a;
}
.type-cursor {
  display: inline-block;
  width: 6px;
  height: 110px; /* ≈ 1.1 × fontSize */
  background: #ffffff; /* overridden every frame by onUpdate */
  margin-left: 4px;
  vertical-align: middle;
  transform: translateY(8px); /* baseline fine-tune */
  will-change: opacity, background-color;
}
```

Cursor dimensions scale with font: width ≈ `fontSize × 0.06`, height ≈ `fontSize × 1.1`. Baseline `translateY(8px)` offsets the cursor block to sit on the text baseline — exact value depends on the font's metrics; eyeball it once at the final font size.

## Single-Phrase Pattern

Use this when you have ONE phrase with main + accent (no sequencing). For multi-phrase scenes, see [dynamic-content-sequencing](dynamic-content-sequencing.md) and combine.

```js
const TEXT_MAIN = "Build video with ";
const TEXT_ACCENT = "HTML";
const CHAR_SPEED = 0.083; // seconds per character (= 2.5 frames @ 30 fps)
const BLINK_CYCLE = 1.0; // seconds per full blink cycle
const TYPE_AT = 0.5; // when typing starts
const HOLD_DUR = 2.0; // seconds to hold the completed phrase
const TOTAL = TYPE_AT + (TEXT_MAIN.length + TEXT_ACCENT.length) * CHAR_SPEED + HOLD_DUR;

const MAIN_COLOR = "#FFFFFF";
const ACCENT_COLOR = "#FF1E7A";

const mainEl = document.querySelector(".type-main");
const accentEl = document.querySelector(".type-accent");
const cursorEl = document.querySelector(".type-cursor");

window.__timelines = window.__timelines || {};
const tl = gsap.timeline({ paused: true });

tl.to(
  { tick: 0 },
  {
    tick: 1,
    duration: TOTAL,
    ease: "none",
    onUpdate: () => {
      const t = tl.time();

      // Blink — square wave via modulo. Runs always, even before typing starts.
      cursorEl.style.opacity = t % BLINK_CYCLE < BLINK_CYCLE / 2 ? "1" : "0";

      // Typing — gated by TYPE_AT
      const activeT = t - TYPE_AT;
      if (activeT < 0) {
        if (mainEl.textContent !== "") mainEl.textContent = "";
        if (accentEl.textContent !== "") accentEl.textContent = "";
        cursorEl.style.background = MAIN_COLOR;
        return;
      }

      const charIdx = Math.floor(activeT / CHAR_SPEED);
      const mainLen = TEXT_MAIN.length;
      const visMain = TEXT_MAIN.slice(0, Math.min(charIdx, mainLen));
      const accLen = Math.max(0, charIdx - mainLen);
      const visAcc = TEXT_ACCENT.slice(0, accLen);

      if (mainEl.textContent !== visMain) mainEl.textContent = visMain;
      if (accentEl.textContent !== visAcc) accentEl.textContent = visAcc;

      // Color switches when the cursor crosses the segment boundary
      const inAccent = visMain.length === mainLen && visAcc.length > 0;
      cursorEl.style.background = inAccent ? ACCENT_COLOR : MAIN_COLOR;
    },
  },
  0,
);

window.__timelines["main"] = tl;
```

### Why `style.background` and not a GSAP `backgroundColor` tween

`backgroundColor` is a discrete switch here — `#FFFFFF` to `#FF1E7A` at one instant. Tweening would smear it over time, which defeats the "color flips when the segment changes" signal. A direct DOM write is correct and matches the source semantic.

If you _do_ want a soft 0.05–0.10 s fade between the two colors (sometimes nicer for very large text), use a separate `tl.to(cursorEl, { backgroundColor: ACCENT_COLOR, duration: 0.08 }, segmentBoundaryTime)` — but compute `segmentBoundaryTime = TYPE_AT + TEXT_MAIN.length * CHAR_SPEED` ahead of time, not on the fly.

## Variations

### Non-Blinking During Active Typing

A blink during active typing reads as a "stutter" because the visible character count is already moving every frame. Lock the cursor to fully visible while characters are being added, blink only during hold:

```js
const isTyping = activeT >= 0 && activeT < (mainLen + TEXT_ACCENT.length) * CHAR_SPEED;
cursorEl.style.opacity = isTyping ? "1" : t % BLINK_CYCLE < BLINK_CYCLE / 2 ? "1" : "0";
```

### Smooth Color Fade (Two-Tween Boundary)

If a hard color flip looks too abrupt at very large font sizes:

```js
const BOUNDARY_T = TYPE_AT + TEXT_MAIN.length * CHAR_SPEED;
tl.to(cursorEl, { backgroundColor: ACCENT_COLOR, duration: 0.1, ease: "none" }, BOUNDARY_T);
```

When you do this, _remove_ the `cursorEl.style.background = …` line from the onUpdate — otherwise the per-frame write and the tween fight each other.

### Keyword-Based Color (Position, Not Segment)

For a single text string with a _highlighted region_ (not two segments):

```js
const HIGHLIGHT_START = 14; // char index where the highlight begins
const inHighlight = charIdx > HIGHLIGHT_START && charIdx <= HIGHLIGHT_START + HIGHLIGHT_LEN;
cursorEl.style.background = inHighlight ? ACCENT_COLOR : MAIN_COLOR;
```

## Critical Constraints

- **Flexbox layout, not absolute positioning** — the cursor sits inline with the text so it naturally follows the typing position. Absolute positioning would require measuring text every frame.
- **`Math.floor` on `charIdx`** — float indices passed to `slice` produce undefined visual results.
- **`white-space: pre`** — required when `textMain` ends with a space. Without it the trailing space collapses and the accent joins immediately.
- **Cursor color matches the segment color, exactly** — using a different accent-cursor color from the accent-text color breaks the visual link.
- **Cursor `transform: translateY(...)` is static CSS** — don't tween it. The baseline fine-tune is a one-time alignment, not an animation channel.
- **`textContent !== visible` guard** — avoid redundant DOM writes during hold windows when `charIdx` hasn't advanced.
- **`will-change: opacity, background-color`** — hints the compositor; without it the per-frame opacity flip may cause layout jitter on weaker GPUs.
- **No `Math.random` / `Date.now`** — all cursor state is a pure function of `tl.time()`.

## Combinations

- [dynamic-content-sequencing](dynamic-content-sequencing.md) — wrap this pattern in a multi-phrase sequencer for the full [messaging-multi-phrase](../blueprints/messaging-multi-phrase.md) blueprint.
- [discrete-text-sequence](discrete-text-sequence.md) — for typing patterns that aren't strictly character-by-character (typos, pauses, bulk additions). Use that rule's `pickDiscrete` instead of the per-char `slice` here.
- [camera-cursor-tracking](camera-cursor-tracking.md) — a virtual camera locks to the cursor's screen position so long-typing phrases stay framed.

## Examples

- [messaging-multi-phrase.html](../examples/messaging-multi-phrase.html) — three phrases ("Build video with HTML", "Seek any frame", "Render to MP4") typed sequentially with the cursor switching between white and cyan accent at each phrase's main → accent boundary.
- [concept-demo-decode-pan.html](../examples/concept-demo-decode-pan.html) — single-phrase variant; cursor stays the same color but tracks the typing position via camera-cursor-tracking.
