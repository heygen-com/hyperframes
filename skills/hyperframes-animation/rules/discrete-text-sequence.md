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
  background: {bgColor};
  font-family: {monoFont}; /* monospace is required — see Critical Constraints */
}
.terminal {
  display: flex;
  align-items: baseline;
  gap: GUTTER;
  font-weight: 800;
  font-size: TERMINAL_FONT_SIZE;
  color: {textColor};
}
.prompt {
  color: {accentColor};
}
.text-wrap {
  display: inline-flex;
  align-items: baseline;
  /* Fixed-width container prevents the right side from jittering as
     content changes length. Choose width ≥ longest state's width. */
  min-width: TEXT_WRAP_MIN_WIDTH;
  white-space: nowrap;
}
.text {
  color: {textColor};
}
.cursor {
  display: inline-block;
  width: CURSOR_WIDTH;
  color: {accentColor};
  margin-left: CURSOR_GAP;
}
```

## GSAP Timeline + Discrete State Logic

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};

  // SEQUENCE — each entry shows from t to the NEXT entry's t.
  // Non-linear: typos, corrections, bulk additions, pauses.
  // Shape (one realization):
  //   [warm-up keystrokes] → [typo] → [backspaces back to fork] →
  //   [bulk-paste of the corrected continuation] → [completion mark]
  const SEQUENCE = [
    { t: 0.0, text: "" },
    { t: T_K1, text: "{p1}" }, // first keystrokes (~3-5 chars, 0.1-0.2s apart)
    { t: T_K2, text: "{p1 + ' ' + p2_typo}" }, // continuation containing a typo
    { t: T_BS, text: "{p1 + ' ' + p2_partial}" }, // backspace(s) — peel back to the fork
    { t: T_BULK, text: "{fullCorrectedText}" }, // bulk paste — replaces several chars at once
    { t: T_DONE, text: "{fullCorrectedText + ' ✓'}" }, // completion marker
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

  // Drive the discrete display via a 0→TOTAL_DURATION tween's onUpdate
  const driver = { t: 0 };
  tl.to(
    driver,
    {
      t: TOTAL_DURATION,
      duration: TOTAL_DURATION,
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
      p: Math.PI * 2 * BLINK_CYCLES, // BLINK_CYCLES = blinks across composition
      duration: TOTAL_DURATION,
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
const fullText = "{fullPhrase}";
const len = { v: 0 };
tl.to(
  len,
  {
    v: fullText.length,
    duration: TYPE_DUR,
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

Insert a state that holds for `THINK_HOLD_DUR` seconds without changes — feels like the user paused to think:

```js
{ t: T_PRE_PAUSE, text: '{partialPhrase}' },        // last state before the pause
// ... no entries for THINK_HOLD_DUR seconds ...
{ t: T_PRE_PAUSE + THINK_HOLD_DUR, text: '{resumedPhrase}' },
```

### State pulse on completion

When the final state lands (e.g. "✓"), pulse-scale the line briefly for emphasis:

```js
tl.to(
  ".text",
  { scale: COMPLETION_PULSE_SCALE, duration: COMPLETION_PULSE_DUR, yoyo: true, repeat: 1 },
  T_DONE,
);
```

### Per-state color shift

Color-code states by phase (e.g. dim during edit, success color after the completion marker, optional warning color on typo):

```js
// In onUpdate after setting textContent:
if (driver.t > T_DONE) textEl.style.color = "{successColor}";
else if (driver.t < T_K2)
  textEl.style.color = "{textColor}"; // normal typing
else textEl.style.color = "{mutedColor}"; // mid-edit dim
```

## How to Choose Values

### Layout

- **TERMINAL_FONT_SIZE** — font size of the typing line.
  - Range: 48-96 px for full-bleed compositions; smaller for terminal-style detail
  - Constraints: combined with `TEXT_WRAP_MIN_WIDTH` must fit within viewport
- **TEXT_WRAP_MIN_WIDTH** — fixed-width container holding the text.
  - Constraints: must be `≥ widthOf(longest SEQUENCE state) at TERMINAL_FONT_SIZE`. Measure with a hidden probe after `document.fonts.ready` if unsure
  - Effects: too small → right edge jitters as states change length; too large → unused horizontal whitespace pads the composition
- **GUTTER** — flex gap between prompt glyph (`$`, `>`) and text.
  - Range: ~0.3-0.5× `TERMINAL_FONT_SIZE`
- **CURSOR_WIDTH / CURSOR_GAP** — block cursor dimensions.
  - Range: width ~0.3× `TERMINAL_FONT_SIZE`; gap small (single-digit px) so the cursor feels attached to the text

### Sequence timing

- **TOTAL_DURATION** — composition length.
  - Constraints: must be ≥ `T_DONE` + ~1s climax dwell so viewer sees the completion marker
- **T_K1 / T_K2 / T_BS / T_BULK / T_DONE** — milestone timestamps within the SEQUENCE.
  - Range: keystrokes 0.06-0.20s apart for "human typing"; pauses 0.3-0.6s at natural word breaks; bulk paste jumps multiple characters in a single entry
  - Constraints: monotonically increasing; `T_DONE ≤ TOTAL_DURATION - dwell`
- **TYPE_DUR** (smooth-slice variation) — total typing duration for continuous typewriter.
  - Range: `chars × 0.06s` (fast) to `chars × 0.12s` (relaxed)
- **THINK_HOLD_DUR** (thinking-pause variation) — hold time between two SEQUENCE states.
  - Range: 0.8-2.0s; under 0.5s reads as a stutter rather than thought
- **COMPLETION_PULSE_SCALE / COMPLETION_PULSE_DUR** (pulse variation).
  - Range: scale 1.03-1.08 (subtle), duration 0.15-0.30s

### Cursor

- **BLINK_CYCLES** — number of full blink cycles across `TOTAL_DURATION`.
  - Range: `TOTAL_DURATION / 0.8s ≤ BLINK_CYCLES ≤ TOTAL_DURATION / 0.5s` (cycle every 0.5-0.8s reads as a natural cursor)

### Color tokens

- **{bgColor} / {textColor} / {accentColor} / {successColor} / {mutedColor}** — discrete choices, not numeric ranges. Pick from the composition's palette; the prompt + cursor share `{accentColor}` so they read as the same "system" element.

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

- `/hyperframes-animation` — onUpdate-driven discrete state lookup
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
