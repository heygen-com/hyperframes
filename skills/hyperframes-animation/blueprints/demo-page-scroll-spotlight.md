---
id: demo-page-scroll-spotlight
role: demo
duration_seconds: [5, 9]
phases: 4
visual_arc: page-entry → scroll-to-feature → keyword-highlight → pop-out-emphasis
uses_rules: [3d-page-scroll, asr-keyword-glow]
element_roles:
  page_card: Full webpage recreation rendered as a tilted 3D card
  scroll_content: Page content that scrolls within the clipped card
  highlight_elements: Specific page elements that glow and scale when mentioned in voiceover
  spotlight: Radial gradient overlay that dims non-highlighted areas
when_to_use:
  - Demonstrate a specific feature within its natural UI context
  - Voiceover names features that should highlight in sync
  - Show the product "in action" without a screen recording
  - 3D perspective adds premium feel
when_not_to_use:
  - Product has no webpage or UI to recreate
  - Feature is best shown via actual screen recording
  - Scene only needs a single static product image
triggers: [show the feature, product demo, highlight on page, webpage in 3D, scroll to feature]
---

# Demo · Page Scroll Spotlight (HyperFrames)

3D tilted webpage card enters → scrolls to relevant section → elements highlight synced to voiceover → key element pops forward in 3D with a spotlight.

This blueprint is the HyperFrames port of the Remotion `contextual-product-showcase` choreography. Same four-phase narrative arc; one paused GSAP timeline; the constituent patterns map to [3d-page-scroll](../rules/3d-page-scroll.md) and [asr-keyword-glow](../rules/asr-keyword-glow.md).

## When to Use

- Feature demo scene where voiceover walks through product capabilities
- Product has a DOM-recreated webpage component available
- Multiple elements on the page need sequential highlighting synced to ASR
- The demo should feel premium (3D depth), not flat (screenshot)

## Phase Pipeline

All boundaries are in **seconds** (local — subtract any scene start offset).

| Phase | Time window (s)               | What Happens                                                                      | Skill Reference                                             |
| ----- | ----------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1     | `0 – entryEnd`                | 3D page card scales in; navbar / title / CTA fade up                              | inline entry + [3d-page-scroll](../rules/3d-page-scroll.md) |
| 2     | `keywordsStart – keywordsEnd` | Title keywords glow synced to ASR words                                           | [asr-keyword-glow](../rules/asr-keyword-glow.md)            |
| 3     | `scrollStart – scrollEnd`     | Page content scrolls up to reveal the feature section                             | [3d-page-scroll](../rules/3d-page-scroll.md)                |
| 4     | `popStart – end`              | Key element pops forward in 3D (translateZ + scale) + spotlight dims surroundings | inline 3D pop + radial-gradient overlay                     |

## Layout

```html
<div class="bg"></div>
<div class="perspective-wrap">
  <div class="page-card">
    <div class="scroll-content">
      <!-- Recreated webpage DOM: navbar, hero, features, carousel -->
      <header class="page-navbar">…</header>
      <section class="page-hero">
        <h1 class="hero-title">
          <span class="kw" data-glow-start="0.12" data-glow-end="0.28">1</span>
          <span class="kw" data-glow-start="0.52" data-glow-end="0.72">long</span>
          <!-- … one .kw per glowable word -->
        </h1>
        <p class="hero-sub">…</p>
        <div class="cta-row">…</div>
      </section>
      <section class="page-features">…</section>
      <section class="page-carousel">
        <div class="carousel-main pop-target">…</div>
        <!-- Phase 4 pop-out target -->
        <div class="carousel-side">…</div>
      </section>
    </div>
    <div class="spotlight"></div>
  </div>
</div>
<div class="vignette"></div>
```

```css
.perspective-wrap {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  perspective: 1200px;
}
.page-card {
  width: 92%;
  height: 88%;
  overflow: hidden;
  border-radius: 20px;
  background: var(--page-bg);
  transform-style: preserve-3d; /* required for child translateZ */
  transform: rotateY(-8deg) rotateX(3deg) scale(0.95); /* tilt + initial scale */
  box-shadow:
    -30px 30px 60px rgba(0, 0, 0, 0.4),
    …;
}
.pop-target {
  --glow: 0; /* Phase 4 GSAP tweens this */
  transform-style: preserve-3d;
  transform: translateZ(calc(var(--glow) * 80px)) scale(calc(1 + var(--glow) * 0.15));
}
.spotlight {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(
    ellipse 850px 550px at 40% 60%,
    transparent 0%,
    transparent 50%,
    rgba(0, 0, 0, 0.65) 100%
  );
  opacity: 0; /* GSAP fades in during Phase 4 */
  z-index: 150;
}
```

## Phase 1: Card Entry

```js
// Page card scales up from 0.95 (already set in CSS) to 1.0.
tl.fromTo(".page-card", { scale: 0.95 }, { scale: 1.0, duration: 0.8, ease: "power2.out" }, 0);

// Internal elements fade in with small offsets so navbar lands first, title second, CTA last.
tl.fromTo(".page-navbar", { opacity: 0 }, { opacity: 1, duration: 0.6, ease: "power2.out" }, 0);
tl.fromTo(".hero-title", { opacity: 0 }, { opacity: 1, duration: 0.7, ease: "power2.out" }, 0.17);
tl.fromTo(".cta-row", { opacity: 0 }, { opacity: 1, duration: 0.7, ease: "power2.out" }, 0.5);
```

## Phase 2: ASR-Synced Keyword Highlighting

Each `.kw` span carries `data-glow-start` / `data-glow-end` attributes — its ASR timestamps. A per-word pair of tweens drives the `--glow` custom property through the attack-sustain-release envelope. See [asr-keyword-glow](../rules/asr-keyword-glow.md) for the full pattern.

```js
const KEYWORD_REST_LEVEL = 0.14;
const SUSTAIN = 0.5;

document.querySelectorAll(".kw").forEach((kw) => {
  const start = +kw.dataset.glowStart;
  const end = +kw.dataset.glowEnd;
  const peak = start + (end - start) / 2;
  const restAt = end + SUSTAIN;

  // Attack (0 → 1) and decay (1 → KEYWORD_REST_LEVEL).
  tl.fromTo(
    kw,
    { "--glow": 0 },
    { "--glow": 1, duration: peak - start, ease: "power2.out" },
    start,
  );
  tl.to(kw, { "--glow": KEYWORD_REST_LEVEL, duration: restAt - peak, ease: "power2.out" }, peak);
});
```

Once a word reaches `KEYWORD_REST_LEVEL`, GSAP holds the value — the "breadcrumb trail" of glow accumulates as the voiceover proceeds.

## Phase 3: Scroll

```js
const SCROLL_AT = 3.08;
const SCROLL_DISTANCE = 280; // px — depends on the page layout

tl.fromTo(
  ".scroll-content",
  { y: 0 },
  { y: -SCROLL_DISTANCE, duration: 1.0, ease: "power2.inOut" }, // programmatic-scroll feel
  SCROLL_AT,
);
```

**Scroll distance must be precise.** Don't estimate — measure once at design time by laying out the page and reading the offset to the target section, then bake the value as a constant.

## Phase 4: 3D Pop-Out + Spotlight

The pop-out target's `--glow` rises from 0 → 1 over a short window; CSS `calc()` on the same element derives `translateZ` and `scale`. The spotlight's `opacity` tweens up in parallel.

```js
const POP_AT = 3.58;
const POP_ATTACK_DUR = 0.67;
const POP_DECAY_DUR = 0.33;
const POP_END = 8.84;
const POP_REST = 0.5;

// Attack the pop-target glow to 1, then decay to REST near the end of the window.
tl.fromTo(
  ".pop-target",
  { "--glow": 0 },
  { "--glow": 1, duration: POP_ATTACK_DUR, ease: "power2.out" },
  POP_AT,
);
tl.to(
  ".pop-target",
  { "--glow": POP_REST, duration: POP_DECAY_DUR, ease: "power2.out" },
  POP_END - POP_DECAY_DUR,
);

// Spotlight fades in immediately, holds, fades out slightly at end (optional).
tl.to(".spotlight", { opacity: 1, duration: 0.5, ease: "power2.out" }, POP_AT);
```

Because `--glow` drives `translateZ + scale` via CSS calc, the pop motion lands deterministically:

```css
.pop-target {
  --glow: 0;
  transform-style: preserve-3d;
  transform: translateZ(calc(var(--glow) * 80px)) scale(calc(1 + var(--glow) * 0.15));
  box-shadow:
    0 0 calc(var(--glow) * 25px) rgba(237, 203, 80, calc(var(--glow) * 0.7)),
    0 calc(20px + var(--glow) * 40px) 60px rgba(0, 0, 0, 0.6);
  border: 3px solid rgba(237, 203, 80, calc(var(--glow) * 0.8));
}
```

The card's parent must have `transform-style: preserve-3d` for `translateZ` to read as depth (the `.page-card` already sets this — same chain).

## Inter-Phase State Handoff

```
Phase 1 → Phase 2:
  Title fade-in completes around t ≈ 0.5s.
  Phase 2's first keyword glow ramps from its ASR start (e.g. 0.12).
  Slight overlap is fine — the title is already visible enough at 0.3s.

Phase 2 → Phase 3:
  Last keyword's KEYWORD_REST_LEVEL is set; GSAP holds it.
  SCROLL_AT can begin before the rest level is reached — the keywords stay
  visibly glowing through the scroll because their tweens have already set
  KEYWORD_REST_LEVEL by then.

Phase 3 → Phase 4:
  Scroll completes around SCROLL_AT + 1.0 = 4.08.
  POP_AT (3.58) starts BEFORE the scroll completes — pop and scroll
  overlap. This is intentional: the pop draws the eye to where the
  scroll will land.

Throughout:
  The page's tilt (rotateY -8°, rotateX 3°) is STATIC. Never tween it.
  Animating the tilt makes the card feel like a UI flip, not a camera setup.
```

## Critical Constraints

- **Page must be a DOM recreation**: Screenshots can't have individually highlighted elements. Recreate the layout with real HTML.
- **`transform-style: preserve-3d` chain**: From `.perspective-wrap` (perspective set) down to `.page-card` (preserve-3d) down to `.pop-target` — every link in the chain. Otherwise `translateZ` on `.pop-target` collapses to no depth.
- **Pre-calculated scroll distance**: Measure once at design time. Per-frame derivation drifts sub-pixels under the 5×-zoom-via-scroll-feeling.
- **Static tilt**: `rotateY`/`rotateX` set once in CSS. Don't tween them — the page is a camera setup, not a flip card.
- **Shadow direction matches tilt**: Left-leaning card (`rotateY: -8deg`) = shadow falls to the **right** (positive X offset). Mismatched shadow reads as a flat layer with a fake drop shadow.
- **`overflow: hidden` on `.page-card`**: Scrolling content clips at card boundaries.
- **`--glow` is the single source of truth per glowable element**: All visual effects (text-shadow, color, scale, translateZ) derive from this CSS variable via `calc()`. Don't run multiple GSAP tweens per word for each effect.
- **Spotlight is a separate overlay**: Don't try to dim by tinting the page-card's background — the surrounding non-highlighted content needs to read at full saturation but with the radial mask covering it.
- **No `Math.random` / `Date.now`**: All envelopes are pure functions of `tl.time()`.
- **Single paused timeline**: All phases on one `gsap.timeline({ paused: true })`, registered to `window.__timelines[data-composition-id]`.

## Spring → GSAP Ease Cheatsheet (this blueprint)

| Source spring                                          | This blueprint uses                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------- |
| `spring({ stiffness: 70, damping: 14 })` — card entry  | `power2.out` over 0.8s                                              |
| `spring({ stiffness: 60, damping: 20 })` — page scroll | `power2.inOut` over 1.0s (programmatic-scroll feel)                 |
| `interpolate(...)` per-frame envelope                  | `--glow` CSS variable + two GSAP `power2.out` tweens per word       |
| Pulsing glow (sine)                                    | Optional second tween on a separate `--pulse` variable, finite yoyo |

See [hyperframes-animation/SKILL.md](../SKILL.md) for the full spring → ease mapping table.

## Golden Sample

- [demo-page-scroll-spotlight.html](../examples/demo-page-scroll-spotlight.html) — OpusClip landing page recreated as a 3D-tilted card: title with 6 ASR-glowable keywords → scroll down 280 px → main video pops forward 80 px in Z with a radial spotlight dimming the rest. Single paused GSAP timeline drives all four phases over 9 seconds.
