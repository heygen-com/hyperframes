---
name: gradient-text-sweep
description: A gradient tweened THROUGH letterforms — background-clip:text + a backgroundPosition tween. Three forms: a continuous horizontal sweep inside a held headline, a traveling word-to-word highlight, and a hue-sweep that settles to a solid. Glyphs never move; finite, deterministic, seek-safe.
metadata:
  tags: gradient, text, sweep, background-clip, highlight, hue, typography, headline
---

# Gradient Text Sweep

Color that lives **inside the glyphs**: the headline's fill is an oversized gradient clipped into the letterforms (`background-clip: text`), and the motion is the gradient sliding **through** the type — the letters never move. Three forms: a **continuous sweep** across a held title card, a **word-to-word highlight** that lights a line left→right, and a **hue-sweep** that settles to a solid.

Boundaries: [asr-keyword-glow.md](asr-keyword-glow.md) is word-timed emphasis railed to ASR timestamps — this rule is a design beat with no audio rail. [ambient-glow-bloom.md](ambient-glow-bloom.md)'s traveling sweep is a sheen riding **over a surface**; here the gradient is masked **into the type** (its "Shimmer sweep" variation is this mechanism re-aimed as a working-state loop). [css-marker-patterns.md](css-marker-patterns.md) draws accents _around_ text, never fills.

## How It Works

The text carries a gradient background **wider than its own box** (`background-size: SWEEP_SPAN 100%`, e.g. `300% 100%`) clipped into the glyphs, so tweening `backgroundPosition` slides the gradient through the visible letterforms. Two gotchas own this rule:

- **`background-position` percentages only produce travel when `background-size` exceeds 100%** — at 100% the image is pinned and the tween is a silent no-op.
- **The percent axis runs opposite to the perceived travel** — tweening `"100% 50%"` → `"0% 50%"` moves the highlight left→right through the text.

1. **Continuous sweep (held title card)** — one long **linear** `backgroundPosition` tween spanning the hold. First and last color stops equal, so the travel has no visible seam and reads as endless while remaining a single finite tween.
2. **Word-to-word highlight** — each word is two pixel-identical stacked copies: a base copy in the resting color and a gradient-clipped copy at `opacity: 0`. A per-word opacity envelope (rise, then fall as the next word rises) passes the highlight along on an index-derived stagger — an **envelope, not a moving mask**: no per-word position measurement.
3. **Hue-sweep → solid** — the gradient holds position while a `filter: hue-rotate()` tween sweeps its hues; the settle is a stacked-copy crossfade to a solid twin — never a color-stop tween (gradients with different stops don't interpolate reliably).

## Recipe

```html
<!-- inside a standard scene clip (hyperframes-core) -->
<!-- Forms A/C: gradient headline; solid twin behind for the Form C settle -->
<div class="headline-stack">
  <h1 class="headline solid-twin">{headlineText}</h1>
  <h1 class="headline gradient-fill" id="headline">{headlineText}</h1>
</div>

<!-- Form B: per-word stacked copies -->
<p class="line">
  <span class="word"><span class="w-base">{word1}</span><span class="w-hot">{word1}</span></span>
  <span class="word"><span class="w-base">{word2}</span><span class="w-hot">{word2}</span></span>
</p>
```

```css
.headline-stack,
.word {
  display: grid; /* twins share one cell — pixel-identical boxes */
}
.headline,
.w-base,
.w-hot {
  grid-area: 1 / 1;
}
.gradient-fill,
.w-hot {
  background-image: {gradient}; /* {sweepGradient} A/C, {highlightGradient} B */
  background-size: SWEEP_SPAN 100%; /* MUST exceed 100% or the position tween is dead */
  background-position: 100% 50%; /* start; tween toward 0% for left→right travel */
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.solid-twin {
  color: {settleColor};
}
.w-base {
  color: {restColor};
}
.w-hot {
  opacity: 0; /* the envelope raises it as the highlight passes */
}
```

```js
// Form A: continuous sweep. 100% → 0% reads left→right (percent axis inverted);
// ease "none" — an eased sweep reads as an object, not light.
tl.fromTo(
  "#headline",
  { backgroundPosition: "100% 50%" },
  { backgroundPosition: "0% 50%", duration: SWEEP_DUR, ease: "none" },
  SWEEP_START,
);

// Form B: traveling highlight — per-word rise/fall envelopes, index stagger.
gsap.utils.toArray(".w-hot").forEach((el, i) => {
  const at = HIGHLIGHT_START + i * WORD_LAG;
  tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: HOT_RISE, ease: "power2.out" }, at);
  tl.to(el, { opacity: 0, duration: HOT_FALL, ease: "power2.in" }, at + WORD_LAG);
});

// Form C: hue-sweep, then crossfade to the solid twin (never tween color stops).
tl.fromTo(
  "#headline",
  { filter: "hue-rotate(0deg)" },
  { filter: `hue-rotate(${HUE_RANGE}deg)`, duration: HUE_DUR, ease: "power1.inOut" },
  HUE_START,
);
tl.to(
  "#headline",
  { opacity: 0, duration: SETTLE_SNAP_DUR, ease: "power2.in" },
  HUE_START + HUE_DUR,
);
```

## Variations

- **Title-card crawl** — Form A stretched across a long terminal hold (3–8s end card): seamless-ended gradient, `ease: "none"`, `SWEEP_DUR` = the whole hold. One tween, no loop.
- **One-pass sheen inside type** — gradient is the resting fill everywhere except one narrow highlight band (≤ ~25% of the span); one `backgroundPosition` pass carries the band through and the text returns to rest with no crossfade.
- **Karaoke settle** — Form B with the fall tweens skipped: the line lights cumulatively left→right and holds fully lit; settle color = the hot state, base copies start dimmer.
- **Gradient climax word** — one emphasized word (often ~-8° rotated) carries the gradient while the line stays solid; static gradient + a short Form C hue shift on landing, settling to the brand accent. Pairs with a `kinetic-beat-slam` arrival.

## Values

| token               | range                  | notes                                                                                |
| ------------------- | ---------------------- | ------------------------------------------------------------------------------------ |
| SWEEP_SPAN          | 200–400%               | must exceed 100%; wider = softer/slower feel, narrower = busier color per glyph      |
| SWEEP_DUR           | 1.2–3s                 | match the card's hold exactly; slower than ~4s stops registering as motion           |
| WORD_LAG            | 0.25–0.5s              | HOT_FALL starts exactly WORD_LAG after the rise so envelopes cross — a gap = a blink |
| HOT_RISE / HOT_FALL | 0.15–0.3s / 0.25–0.45s | fall slightly longer — the highlight "trails"                                        |
| HUE_RANGE / HUE_DUR | 40–180° / 0.8–1.6s     | past ~180° the palette dissociates from itself mid-sweep                             |
| SETTLE_SNAP_DUR     | 0.1–0.35s              | the goldens snap (~0.15s)                                                            |
| {settleColor}       | —                      | one of the gradient's own stops (or the brand ink) so the settle reads as resolution |

## Critical Constraints

- **`background-size` > 100%** on any element whose `backgroundPosition` is tweened — otherwise the tween is a silent no-op.
- **Percent axis is inverted** — left→right perceived travel is `100% → 0%`.
- **Both `-webkit-background-clip: text` AND `background-clip: text`, with `color: transparent`** — missing the prefix renders a solid gradient block over the text in the capture browser.
- **`ease: "none"` on position sweeps** — this is supposed to read as light, not an accelerating object.
- **Seamless ends for a crawl** — first and last stops equal, or the wrap point flashes a hard edge mid-hold.
- **Stacked copies pixel-identical** — same box, font, weight, tracking, one grid cell; any metric drift makes the crossfade a double-exposure.
- **`data-layout-allow-occlusion` on the twin** — pixel-identical stacked copies trip `hyperframes check`'s `text_occluded` gate by construction; the flag is the sanctioned waiver for this mechanism.
- **Settle by crossfade, never by tweening stops**; and the glyphs never move — if the type must travel, that's a separate rule on the wrapper.
- **No CSS `@keyframes` shimmer** — wall-clock animation desyncs from seek; every sweep is a timeline tween.

## See also

`kinetic-beat-slam` (slam lands the climax word, hue settle finishes it) · `spring-pop-entrance` (pop in solid, sweep after) · `discrete-text-sequence` (swap-slot under a riding crawl) · `ambient-glow-bloom` (surface-level sibling) · `css-marker-patterns` (strokes around text; fills here).
