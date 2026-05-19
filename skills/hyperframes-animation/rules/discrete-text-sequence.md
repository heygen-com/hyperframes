---
name: discrete-text-sequence
description: Replace entire text states at frame thresholds for non-linear typing effects — typos, bulk additions, pauses, backspaces, simulated thinking.
metadata:
  tags: text, typing, discrete, threshold, non-linear, sequence
---

# Discrete Text Sequence

Instead of character-by-character typewriter, replace entire string states at time thresholds. Enables non-linear effects (typos, bulk additions, pauses, "thinking" gaps) that smooth per-char typing can't achieve.

## How It Works

An array of `{ text, t }` pairs where `t` is a time in seconds. On every onUpdate, scan the array for the latest entry whose `t` has passed and render that text. The display jumps between states; no animation between them.

For continuous per-char typewriter (no pauses, no edits), use the **smooth-slice** variation at the bottom.

## HTML

```html
<div
  class="scene"
  id="seq-scene"
  data-composition-id="seq-scene"
  data-start="0"
  data-duration="6"
  data-track-index="0"
>
  <div class="terminal">
    <div class="prompt">$</div>
    <div class="text-wrap">
      <span class="text" id="text">|</span>
      <span class="cursor" id="cursor">_</span>
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
  font-weight: 800;
  font-size: 72px;
  color: #f5f6fb;
}
.prompt {
  color: #a78bfa;
}
.text-wrap {
  display: inline-flex;
  align-items: baseline;
  /* Fixed-width container prevents the right side from jittering as
     content changes length. Choose width ≥ longest state's width. */
  min-width: 1100px;
  white-space: nowrap;
}
.text {
  color: #f5f6fb;
}
.cursor {
  display: inline-block;
  width: 20px;
  color: #a78bfa;
  margin-left: 4px;
}
```

## GSAP Timeline + Discrete State Logic

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};

  // State sequence — each entry shows from t to the NEXT entry's t.
  // Non-linear: typos, corrections, bulk additions, pauses.
  const SEQUENCE = [
    { t: 0.0, text: "" },
    { t: 0.3, text: "b" },
    { t: 0.5, text: "bu" },
    { t: 0.7, text: "bun" }, // user starts typing
    { t: 0.9, text: "bunx" },
    { t: 1.1, text: "bunx h" },
    { t: 1.3, text: "bunx hy" },
    { t: 1.5, text: "bunx hyperfrim" }, // typo
    { t: 1.9, text: "bunx hyperfri" }, // backspace
    { t: 2.0, text: "bunx hyperfr" },
    { t: 2.1, text: "bunx hyperf" },
    { t: 2.4, text: "bunx hyperframes" }, // correction + bulk
    { t: 2.7, text: "bunx hyperframes render" },
    { t: 3.0, text: "bunx hyperframes render ." },
    { t: 3.5, text: "bunx hyperframes render . --output heygenverse.mp4" }, // bulk paste
    { t: 5.0, text: "bunx hyperframes render . --output heygenverse.mp4 ✓" }, // completion mark
  ];

  // Reverse-search for the latest entry whose t has passed.
  function textAt(time) {
    for (let i = SEQUENCE.length - 1; i >= 0; i--) {
      if (time >= SEQUENCE[i].t) return SEQUENCE[i].text;
    }
    return "";
  }

  const textEl = document.getElementById("text");
  const cursorEl = document.getElementById("cursor");
  const tl = gsap.timeline({ paused: true });

  // Drive the discrete display via a 0→duration tween's onUpdate
  const totalDuration = 6.0;
  const driver = { t: 0 };
  tl.to(
    driver,
    {
      t: totalDuration,
      duration: totalDuration,
      ease: "none",
      onUpdate: () => {
        textEl.textContent = textAt(driver.t);
      },
    },
    0,
  );

  // Cursor blink — deterministic via sin, not CSS animation
  const blinkDriver = { p: 0 };
  tl.to(
    blinkDriver,
    {
      p: Math.PI * 2 * 6, // 6 blinks across composition
      duration: totalDuration,
      ease: "none",
      onUpdate: () => {
        cursorEl.style.opacity = Math.sin(blinkDriver.p) > 0 ? "1" : "0";
      },
    },
    0,
  );

  window.__timelines["seq-scene"] = tl;
</script>
```

## Variations

### Smooth character slice (continuous typewriter — no pauses, no edits)

For straight-forward typewriter without the non-linear chaos:

```js
const fullText = "bunx hyperframes render . --output heygenverse.mp4";
const len = { v: 0 };
tl.to(
  len,
  {
    v: fullText.length,
    duration: 3.5,
    ease: "power1.inOut",
    onUpdate: () => {
      textEl.textContent = fullText.substring(0, Math.floor(len.v));
    },
  },
  0,
);
```

This is faster to author but produces a uniform "machine-typed" feel — missing the human-typing realism.

### Thinking pause (extended hold on a key state)

Insert a state that holds for 1-2s without changes — feels like the user paused to think:

```js
{ t: 1.4, text: 'bunx hy' }, // start
// ... no entries between 1.4 and 2.6 ...
{ t: 2.6, text: 'bunx hyperframes' }, // resume after pause
```

### State pulse on completion

When the final state lands (e.g. "✓"), pulse-scale the line briefly for emphasis:

```js
tl.to(".text", { scale: 1.05, duration: 0.2, yoyo: true, repeat: 1 }, 4.8);
```

### Per-state color shift

Color-code states (yellow during edit, green after success, red on typo):

```js
// In onUpdate after setting textContent:
if (driver.t > 4.8)
  textEl.style.color = "#34d399"; // success green
else if (driver.t < 1.8)
  textEl.style.color = "#f5f6fb"; // typing white
else textEl.style.color = "#a7adc6"; // mid-edit dim
```

## Key Principles

- **Threshold sequence drives realism** — group fast successive keystrokes (0.1-0.2s apart), then pause on word breaks (0.3-0.5s), bulk-paste in single jumps (one entry replaces many chars), include a typo or two for human-typing feel
- **Reverse-search the array each frame** — O(n) per frame, where n is small (≤30 typical). Don't try to index by frame; the sequence is sparse
- **Fixed-width container is mandatory** — without `min-width`, the right edge of the text wrap jitters as state length changes. Set width ≥ longest expected state
- **Cursor must be deterministic** — sin-based or sequence-driven blink, NOT a CSS animation. HF seeks frame-by-frame; CSS animations desync
- **No `transition` on the text element** — discrete jumps should be INSTANT. A CSS transition turns the jump into a smear and ruins the "typing" feel
- **❗ Distinguish discrete from smooth** — if your effect is "type each character, no edits" → use the smooth-slice variation. Discrete sequence is overkill for that case. Use discrete only when you need non-linear states (typos, pauses, bulk paste)

## Critical Constraints

- **Timeline must be paused**: `gsap.timeline({ paused: true })`
- **Registry key = `data-composition-id`**
- **No CSS `transition`** on the text or any of its parents
- **Cursor `display: inline-block`** — `display: inline` ignores width/transform
- **Monospace font** for terminal-style effects — proportional fonts cause visual jitter even with fixed-width container
- **Whitespace: nowrap** on text wrap — wrapping mid-state breaks the illusion

## Combinations

- [3d-text-depth-layers.md](3d-text-depth-layers.md) — discrete text rendered with layered depth (heavy, dramatic)
- [counting-dynamic-scale.md](counting-dynamic-scale.md) — discrete text for the LABEL while counter animates smoothly
- [press-release-spring.md](press-release-spring.md) — after the sequence completes, the line "presses" like a button confirming success

## Pairs with HF skills

- `/hyperframes-gsap` — onUpdate-driven discrete state lookup
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
