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

1. **Phase A (0 → ~60% progress)**: character displays a randomly-substituted glyph that flickers (changes every N frames)
2. **Phase B (~60% → 100% progress)**: character displays the REAL target character, settling into its final upright position

The 0.6 threshold separates "scrambled" from "revealed" — by the time the flip is mostly done, viewer sees the correct letter clicking into place.

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
  <div class="hacker-text-wrap" id="hacker-text" data-target="HYPERFRAMES">
    <!-- Per-char spans get injected by setup script below.
         Ghost placeholder (data-ghost) is rendered identically to reserve width. -->
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
  perspective: 1500px; /* REQUIRED — without this rotateX renders flat */
}

.hacker-text-wrap {
  font-family: "JetBrains Mono", "Inter", monospace;
  font-weight: 900;
  font-size: 140px;
  color: #f5f6fb;
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
   Without this, "I" (narrow) collapses width when displayed and characters
   shift horizontally during flicker. */
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
  const targetWord = wrap.dataset.target || "HYPERFRAMES";
  const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*";
  const FLICKER_RATE = 4; // glyph swaps every 4 frames

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
    span.textContent = ch === " " ? " " : ch;
    span.dataset.target = ch;
    liveRow.appendChild(span);
    charEls.push(span);
  }
  wrap.appendChild(liveRow);

  // Deterministic "random" — seeded by char index + frame group so same frame
  // always yields same glyph (HF seek determinism)
  function pseudoGlyph(seed) {
    // simple int hash
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
        duration: 0.9,
        ease: "power3.out",
        onUpdate: () => {
          // Phase A: random glyph flickering. Phase B: real character.
          const progress = state.p;
          if (progress < 0.6) {
            // Update glyph every FLICKER_RATE worth of progress
            const flickerSeed = i * 1000 + Math.floor(progress * 100);
            el.textContent = pseudoGlyph(flickerSeed);
          } else {
            el.textContent = el.dataset.target === " " ? " " : el.dataset.target;
          }
          // Flip rotateX from 90 (down) to 0 (upright)
          const rotateX = 90 - progress * 90;
          const opacity = Math.min(1, progress * 2);
          el.style.transform = `rotateX(${rotateX}deg)`;
          el.style.opacity = opacity;
        },
      },
      i * 0.06,
    ); // 0.06s stagger per char
  });

  window.__timelines["hacker-flip-scene"] = tl;
</script>
```

## Key Principles

- **Threshold at 0.6** for swap from random → real glyph — close enough to settled that viewer's eye catches the right letter
- **Hinge at `transform-origin: bottom`** for flap-display look (vs `top` for top-down, vs `center` for spin)
- **Deterministic random** via seeded hash — HF runtime seeks frame-by-frame, so the same frame must show the same glyph (no `Math.random()`)
- **Ghost placeholder** sits behind the live chars with identical content + same font, reserving width — without it, narrow glyphs like "I" or numbers shift the layout mid-flicker
- **Stagger 0.04-0.08s** per char — too fast and chars overlap visually, too slow and effect feels labored
- **❗ Center the main flip dead-center via `display: grid; place-items: center;`** on the scene root — and DO NOT add decorative headers/footers (timestamp lines, "// AUTH" tags, small green "● DECRYPTED" dots). The flip text IS the focal beat; surrounding clutter dilutes it. If a secondary label is necessary (e.g. "Decrypted" status), promote it to BIG typography in the same stacked layout (56-72px caps + tracking), not a tiny corner annotation.

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

- `/hyperframes-gsap` — timeline + per-char stagger + `onUpdate`
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
