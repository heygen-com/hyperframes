# Motion Vocabulary - named word-entry moves

10 motion primitives the skill uses. Each has a specific timing + easing + situational fit. Agent picks by **content tone**, not default to one.

**Easing philosophy:** `outCubic` is the "considered confident" default. `linear` is almost always wrong. Back-easing and elastic easing are for playful content only, never documentary.

**Exit rules:** Default exit is the same tween reversed at 60% duration. Never exit with a different motion than entry unless doing a rhetorical pivot. Never fade out during speech - only during the gap between phrases.

---

## The 10 moves

### 1. typewriter

Char-by-char reveal, 25–35ms/char, linear easing. Documentary / data-heavy / tense / interrogative.

```js
words.forEach((w, i) => {
  const chars = w.textContent.split("");
  w.textContent = "";
  chars.forEach((c, j) => {
    const span = document.createElement("span");
    span.textContent = c;
    span.style.opacity = 0;
    w.appendChild(span);
    tl.add(span, { opacity: 1, duration: 0 }, ms(wordStart + j * 0.028));
  });
});
```

### 2. word-fade-up (DEFAULT)

Per-word, 80ms stagger, `opacity 0→1 + translateY 8→0`, `cubic-bezier(.2,.7,.2,1)` (ease-out). Default for conversational content.

```js
tl.add(word, { opacity: 0, y: 8, duration: 0 }, ms(wordStart));
tl.add(word, { opacity: 1, y: 0, duration: 450, ease: "outCubic" }, ms(wordStart));
```

### 3. word-pop

Per-word, 60ms stagger, `scale 0.85→1 + opacity 0→1`, elastic-light `cubic-bezier(.34,1.56,.64,1)`. Energetic / YouTube-vlog / high-tempo. **Never for documentary.**

### 4. swipe-reveal

Whole phrase at once, 400ms, `clip-path inset 0 100% 0 0 → 0 0 0 0`, expo `cubic-bezier(.77,0,.175,1)`. Keynote / tech product / announcement.

```css
.cap {
  clip-path: inset(0 100% 0 0);
}
/* animate to inset(0 0 0 0) */
```

### 5. drop-and-settle

Per-word, 120ms stagger, `y: -30→0` with back-bounce `cubic-bezier(.68,-.55,.27,1.55)`. Playful but controlled. **Not for documentary.**

### 6. etch

Whole word at once, 600ms, opacity ramp `0→1` with slight blur→sharp transition. Ease-in-out. Poetic / lyrical / "quote on wall" direction.

### 7. crosshair

Per-word, 200ms total: two 1px lines converge on word center (linear 150ms), then word snaps in (expo-out 50ms). Thriller / investigative doc.

### 8. breathing-hold

**Static but alive.** No entry animation. Once visible, micro-scale loop `1.00↔1.008` over 2s, sine ease. Used on climax lines held 1.5s+.

### 9. cascade

Each word from alternating direction: L, R, L, R. `translateX: ±40→0`, ease-out 300ms. **Rhythm-break move** - use sparingly, once per 30s max.

### 10. burn-in

**Zero animation.** Sudden 1-frame opacity 1. No fade, no transform. Interview-doc style. Use for every 6–8th phrase in a documentary direction for variety (Standard mode; see direction-catalog §1).

---

## Tone → timing lookup table

| Tone           | Stagger                   | Hold        | Entry move                         |
| -------------- | ------------------------- | ----------- | ---------------------------------- |
| documentary    | 150ms                     | 600ms       | burn-in (70%) + word-fade-up (30%) |
| conversational | 80ms                      | 400ms       | word-fade-up                       |
| energetic      | 50ms                      | 300ms       | word-pop                           |
| poetic         | 250ms                     | 1200ms      | etch                               |
| broadcast      | 0 (burn-in)               | BBC timings | burn-in                            |
| investigative  | 25ms/char                 | 500ms       | typewriter                         |
| keynote        | 0 per-word (phrase swipe) | 600ms       | swipe-reveal                       |

Agent picks tone → this table → anime.js parameters. Data, not guesswork.

---

## Per-word vs per-phrase animation axis

Orthogonal to the 10 moves above.

- **Per-word animation** (default): each word enters at its `w.start` timestamp. Tight sync with speech.
- **Per-phrase animation**: whole group enters/exits at `g.in`/`g.out`. Words appear together. Used for:
  - swipe-reveal moves
  - burn-in (no animation, but the "reveal" is a group event)
  - title cards / chapter breaks

Rule: per-word for content that tracks speech; per-phrase for moments that step outside the speech flow.

---

## Stagger breakdown by context

Fine-tune stagger within a tone:

- **Documentary dialog**: 150ms (measured)
- **Documentary punchline**: 250ms (weighted)
- **Vlog opener**: 50ms (fast hook)
- **Vlog narration**: 70ms (conversational but snappy)
- **Poem / lyric**: 250–400ms per word, with 500–1000ms gaps between phrases
- **Keynote hero**: per-phrase only (stagger = N/A)
- **Interview name card**: 0 stagger (static)

---

## Anti-patterns (banned, from anti-patterns.md)

- Animating `letter-spacing` → reflow
- Animating `filter:blur` → reflow + can wash out text
- `Math.random()` / `Date.now()` in timeline → non-deterministic render
- Entries under 100ms total → frantic, unreadable
- Same motion for every group for 30s+ → eye adapts, stops registering

---

## When to break the vocabulary

The 10 moves are a comfortable coverage, not a ceiling. For Standard mode, invent new moves when the scene demands it:

- Kyle Cooper's scratched typewriter for noir
- K-pop lyric's directional word-from-side
- Film-title flash-cut burn-in with chromatic aberration

When inventing: stay deterministic, stay transform+opacity only, state the motion in terms of the 4 axes (entry, hold, exit, stagger).
