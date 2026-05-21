---
name: hacker-flip-3d
description: Character-level 3D rotation with random glyph substitution for a decryption reveal effect.
metadata:
  tags: text, 3d, reveal, decode, hacker, randomization, perspective
---

# Hacker Flip 3D Reveal

Characters flip down from 90° in 3D while cycling through random glyphs, then settle on the target character. Creates a "decryption" or airport flap-display reveal.

## How It Works

Each character gets its own per-char tween from `rotateX: 90deg` (hidden) to `rotateX: 0deg` (revealed), staggered across the word. During the flip:

1. **Phase A (0 → ~`REVEAL_THRESHOLD` progress)**: character displays a randomly-substituted glyph that flickers (changes every `FLICKER_RATE` frames)
2. **Phase B (`REVEAL_THRESHOLD` → 1.0 progress)**: character displays the REAL target character, settling into its final upright position

The `REVEAL_THRESHOLD` separates "scrambled" from "revealed" — by the time the flip is mostly done, viewer sees the correct letter clicking into place.

## HTML

```html
<div
  class="scene"
  id="hacker-flip-scene"
  data-composition-id="hacker-flip-scene"
  data-start="0"
  data-duration="3"
  data-track-index="0"
>
  <div class="hacker-text-wrap" id="hacker-text" data-target="{phrase}">
    <!-- Per-char spans get injected by setup script below.
         Ghost placeholder (data-ghost) is rendered identically to reserve width. -->
  </div>
</div>
```

`{phrase}` is the target word the flip resolves to (typically a brand or short label).

## CSS

```css
.scene {
  position: relative;
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  background: {bgColor};
  perspective: 1500px; /* REQUIRED — without this rotateX renders flat */
}

.hacker-text-wrap {
  font-family: {monoFont};      /* monospace recommended so flicker glyphs hold width */
  font-weight: 900;
  font-size: HACKER_FONT_SIZE;
  color: {textColor};
  letter-spacing: 4px;
  display: flex;
  /* Ghost / live chars are absolutely stacked; container reserves layout width */
  position: relative;
}

.hacker-char {
  display: inline-block;
  /* Hinge at the bottom edge — flap-display look */
  transform-origin: bottom;
  transform-style: preserve-3d;
  /* Will-change improves render perf */
  will-change: transform, opacity;
}

/* Ghost placeholder is hidden but reserves width for variable-glyph fonts.
   Without this, narrow target glyphs collapse width when displayed and
   characters shift horizontally during flicker. */
.hacker-ghost {
  opacity: 0;
  pointer-events: none;
}
```

## GSAP Timeline + Random Glyph Logic

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};

  const wrap = document.getElementById("hacker-text");
  const targetWord = wrap.dataset.target;
  const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*";

  // Build live chars + ghost placeholders (ghost keeps layout width stable)
  wrap.innerHTML = "";
  const ghostRow = document.createElement("div");
  ghostRow.className = "hacker-ghost";
  ghostRow.style.display = "inline-flex";
  ghostRow.style.position = "absolute";
  ghostRow.style.left = "0";
  ghostRow.style.top = "0";
  ghostRow.textContent = targetWord;
  wrap.appendChild(ghostRow);

  const charEls = [];
  const liveRow = document.createElement("div");
  liveRow.style.display = "inline-flex";
  liveRow.style.position = "relative";
  for (const ch of targetWord) {
    const span = document.createElement("span");
    span.className = "hacker-char";
    span.textContent = ch === " " ? " " : ch;
    span.dataset.target = ch;
    liveRow.appendChild(span);
    charEls.push(span);
  }
  wrap.appendChild(liveRow);

  // Deterministic "random" — seeded by char index + frame group so the same
  // frame always yields the same glyph (HF seek determinism).
  function pseudoGlyph(seed) {
    const h = ((seed * 9301 + 49297) % 233280) / 233280;
    return GLYPHS[Math.floor(h * GLYPHS.length)];
  }

  const tl = gsap.timeline({ paused: true });

  // Per-char flip — stagger across the word
  charEls.forEach((el, i) => {
    const state = { p: 0 };
    tl.to(
      state,
      {
        p: 1,
        duration: FLIP_DURATION,
        ease: "power3.out",
        onUpdate: () => {
          // Phase A: random glyph flickering. Phase B: real character.
          const progress = state.p;
          if (progress < REVEAL_THRESHOLD) {
            // Update glyph every FLICKER_RATE worth of progress
            const flickerSeed = i * 1000 + Math.floor(progress * 100);
            el.textContent = pseudoGlyph(flickerSeed);
          } else {
            el.textContent = el.dataset.target === " " ? " " : el.dataset.target;
          }
          // Flip rotateX from 90 (down) to 0 (upright)
          const rotateX = 90 - progress * 90;
          const opacity = Math.min(1, progress * 2);
          el.style.transform = `rotateX(${rotateX}deg)`;
          el.style.opacity = opacity;
        },
      },
      i * CHAR_STAGGER,
    );
  });

  window.__timelines["hacker-flip-scene"] = tl;
</script>
```

## How to Choose Values

- **HACKER_FONT_SIZE** — font-size of the flip text in px.
  - Range: 6-10% of viewport min-dimension; the flip text is the focal beat, scale accordingly
  - Constraints: ghost row must use the identical size so layout width stays stable mid-flicker
  - Reference: examples/proof-logo-chain.html uses `163px` at 1920×1080
- **FLIP_DURATION** — per-character flip tween duration.
  - Range: 0.4-1.0s; under 0.4s the random-glyph phase has no time to flicker, over 1.0s drags
  - Effects: shorter feels snappy and modern; longer feels mechanical / typewriter
  - Reference: examples/proof-logo-chain.html uses `0.55s`
- **CHAR_STAGGER** — delay between consecutive characters starting their flips, in seconds.
  - Range: 0.03-0.08s; too fast and chars overlap visually, too slow and the effect feels labored
  - Constraints: total decode time = `CHAR_STAGGER × (charCount − 1) + FLIP_DURATION`; ensure this fits the phase budget
  - Reference: examples/proof-logo-chain.html uses `0.033s` (≈2 frames at 60fps)
- **REVEAL_THRESHOLD** — progress at which a glyph swaps from random → real.
  - Range: 0.5-0.7; lower reveals too early (no decode tension), higher feels like a hard reveal at the end
  - Effects: this is a discrete tuning of when the eye locks onto the real letter
  - Reference: examples/proof-logo-chain.html uses `0.6`
- **FLICKER_RATE** — frames between glyph reshuffles during the random phase.
  - Range: 3-6; lower than 3 looks like noise, higher than 6 looks like discrete typing instead of flicker
  - Constraints: must be ≥ ~3 frames (see Critical Constraints)
  - Reference: examples/proof-logo-chain.html uses an equivalent of `3` (one shuffle every 3 internal-clock frames)
- **{bgColor} / {textColor}** — stage background and live-character color tokens.
- **{monoFont}** — monospace family preferred so flicker glyphs don't change width per swap; if a proportional font is required, the ghost placeholder makes the cost recoverable.
- **{phrase}** — the target word the flip resolves to. Length feeds the total decode duration via `CHAR_STAGGER`.

## Variations

- **Top-down hinge** — swap `transform-origin: bottom` to `top` for a falling-flap look.
- **Center spin** — `transform-origin: center` reads as a barrel roll, not a flap.
- **Number-only pool** — restrict `GLYPHS` to digits for a price / countdown decode.
- **Two-pass decode** — chain two `FLIP_DURATION` tweens with different glyph pools (e.g. symbols → letters → real) for a longer reveal.

## Key Principles

- **Threshold at ~`REVEAL_THRESHOLD`** for swap from random → real glyph — close enough to settled that viewer's eye catches the right letter
- **Hinge at `transform-origin: bottom`** for flap-display look (vs `top` for top-down, vs `center` for spin)
- **Deterministic random** via seeded hash — HF runtime seeks frame-by-frame, so the same frame must show the same glyph (no `Math.random()`)
- **Ghost placeholder** sits behind the live chars with identical content + same font, reserving width — without it, narrow glyphs shift the layout mid-flicker
- **Stagger in the 0.04-0.08s range** per char — too fast and chars overlap visually, too slow and effect feels labored
- **Center the flip dead-center via `display: grid; place-items: center;`** on the scene root — and DO NOT add decorative headers/footers (timestamp lines, "// AUTH" tags, small status dots). The flip text IS the focal beat; surrounding clutter dilutes it. If a secondary label is necessary, promote it to BIG typography in the same stacked layout (56-72px caps + tracking), not a tiny corner annotation.

## Critical Constraints

- **`perspective` on scene root REQUIRED** — without parent perspective, `rotateX` looks like a 2D scale, not a 3D flip
- **`transform-style: preserve-3d` on each char** — keeps 3D context intact when chars have their own transforms
- **Timeline must be paused**: `gsap.timeline({ paused: true })`
- **Registry key = `data-composition-id`**
- **Deterministic randomness**: don't use `Math.random()`. Use a seed derived from char index + frame group so seek determinism holds
- **`onUpdate` writes to DOM**: HF seeks every frame, so this runs many times — keep work O(1) per char per frame
- **Flicker rate ≥ ~3 frames per glyph swap**: faster looks like noise, slower looks like discrete typing

## Combinations

- [card-morph-anchor.md](card-morph-anchor.md) — pair: hacker-flip reveals a phrase, then card morphs into the next shot
- [counting-dynamic-scale.md](counting-dynamic-scale.md) — counterpart for numeric reveals (text vs number)

## Pairs with HF skills

- `/hyperframes-animation` — timeline + per-char stagger + `onUpdate`
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
