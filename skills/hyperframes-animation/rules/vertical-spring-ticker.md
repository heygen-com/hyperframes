---
name: vertical-spring-ticker
description: Slot-machine style vertical scrolling using additive spring physics within a masked container — each spring contributes one "step" of scroll.
metadata:
  tags: text, ticker, spring, scroll, vertical, slot-machine, sequence
---

# Vertical Spring Ticker (Slot Machine)

Multiple spring tweens are ADDED TOGETHER to produce total Y translation. Each spring contributes one discrete "step." The combined motion has snappy distinct moves with natural settling — instead of a single linear scroll, you get the slot-machine "click click click" rhythm.

## How It Works

Container has fixed height `ITEM_HEIGHT`, `overflow: hidden`. Inside is a vertical stack of items, each also `ITEM_HEIGHT` tall. The translate of the inner stack is computed as:

```
translateY = -ITEM_HEIGHT * sum(spring_i.progress for each spring)
```

Each spring fires at a different time, settles, then the next fires. When summed, the stack snaps forward step-by-step. The "spring" easing gives each step a tiny overshoot/settle that distinguishes it from a linear marquee.

## HTML

```html
<div
  class="scene"
  id="ticker-scene"
  data-composition-id="ticker-scene"
  data-start="0"
  data-duration="5"
  data-track-index="0"
>
  <div class="stack">
    <div class="eyebrow">{eyebrow}</div>
    <div class="ticker" id="ticker">
      <div class="stack-inner" id="stack-inner">
        <!-- One .item per state the ticker rolls through.
             The example file lists concrete labels; for the rule, treat
             these as positional slots ({item0} … {itemN}). -->
        <div class="item">{item0}</div>
        <div class="item">{item1}</div>
        <div class="item">{item2}</div>
        <div class="item">{item3}</div>
        <div class="item">{itemN}</div>
      </div>
    </div>
    <div class="brand">{footerLine}</div>
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
  font-family: {font};
}
.stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: STACK_GAP;
}
.eyebrow {
  font-size: EYEBROW_FONT_SIZE;
  font-weight: 800;
  letter-spacing: 14px;
  text-transform: uppercase;
  color: {accentColor};
}
/* MANDATORY: container height matches the per-item height exactly */
.ticker {
  width: TICKER_WIDTH;
  height: ITEM_HEIGHT;       /* MUST match .item height */
  overflow: hidden;
  border-top: 2px solid {dividerColor};
  border-bottom: 2px solid {dividerColor};
  position: relative;
}
.stack-inner {
  display: flex;
  flex-direction: column;    /* MANDATORY for vertical ticker */
  will-change: transform;
}
.item {
  height: ITEM_HEIGHT;       /* MUST equal .ticker height */
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: ITEM_FONT_SIZE;
  font-weight: 900;
  letter-spacing: 8px;
  text-transform: uppercase;
  color: {textColor};
  /* font-variant-numeric: tabular-nums; — for numeric tickers */
}
.brand {
  font-size: BRAND_FONT_SIZE;
  font-weight: 800;
  letter-spacing: 10px;
  color: {accentColor};
  text-transform: uppercase;
}
```

## GSAP Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  const innerEl = document.getElementById("stack-inner");

  // Each spring object holds a 0→1 progress; they accumulate to a step-counter.
  // Sum * -ITEM_HEIGHT becomes translateY.
  const springs = Array.from({ length: STEPS }, () => ({ p: 0 }));

  function applyTransform() {
    const sumP = springs.reduce((acc, s) => acc + s.p, 0);
    innerEl.style.transform = `translateY(${-sumP * ITEM_HEIGHT}px)`;
  }
  applyTransform(); // initial state

  // Fire each spring sequentially with overlap — each one snaps in one step
  springs.forEach((spring, i) => {
    tl.to(
      spring,
      {
        p: 1,
        duration: STEP_DUR,
        ease: `back.out(${BOUNCE_FACTOR})`,
        onUpdate: applyTransform,
      },
      STEP_START + i * STEP_SPACING,
    );
  });

  // Footer reveals after the ticker settles on the final item.
  tl.from(
    ".brand",
    { opacity: 0, y: BRAND_Y, duration: BRAND_FADE_DUR, ease: "power3.out" },
    STEP_START + STEPS * STEP_SPACING + BRAND_DELAY,
  );

  window.__timelines["ticker-scene"] = tl;
</script>
```

## How to Choose Values

- **ITEM_HEIGHT** — px height of each ticker slot AND the masked window.
  - Range: ~`ITEM_FONT_SIZE × 1.25`; the line must hold capital descenders without clipping
  - Constraints: **`.ticker` height MUST equal `.item` height** exactly — mismatched values cause partial items to peek above/below the mask
  - Reference: ../../examples/proof-logo-chain.html uses `204px`
- **TICKER_WIDTH** — px width of the masked window.
  - Range: wide enough to hold the longest item without ellipsis; typically 30-60% of viewport width
- **STEPS** — number of additive springs (number of state transitions, not number of items).
  - Range: typically 1-4; each step = one "click" in the slot-machine cadence
  - Constraints: `STEPS ≤ itemCount − 1` (you can only roll as far as there are items below the visible one)
  - Reference: ../../examples/proof-logo-chain.html uses `1` (single roll between two states)
- **STEP_DUR** — duration of each spring tween.
  - Range: 0.3-0.7s; under 0.3 the overshoot is invisible, over 0.7 the click reads as a slide
  - Reference: ../../examples/proof-logo-chain.html uses `0.45s`
- **STEP_SPACING** — seconds between consecutive springs' start times.
  - Range: 0.3-0.5s; closer and the steps blur together (looks like linear scroll), further and the ticker feels lazy
  - Constraints: `STEP_SPACING ≤ STEP_DUR` so the previous step is still settling when the next fires (this is what makes them "additive")
- **STEP_START** — when the first spring fires.
  - Range: 0+; gate behind any preceding beat
- **BOUNCE_FACTOR** — `back.out(BOUNCE_FACTOR)` overshoot strength per step.
  - Range: 1.4 (gentle click) → 2.0 (firm click) → 2.5+ (cartoony spin-and-land for a climax step)
  - Effects: low end reads as polished UI, high end reads as casino / game show
- **BRAND_DELAY** — gap after the final step before the footer line reveals, in seconds.
  - Range: 0.2-0.5s; lets the final overshoot settle before the next element competes for attention
- **BRAND_FADE_DUR** — footer fade-in duration.
  - Range: 0.4-0.7s
- **BRAND_Y** — initial vertical offset of the footer before fade-up (in px).
  - Range: 8-24 px; bigger feels "punched in," smaller feels gentle
- **EYEBROW_FONT_SIZE / ITEM_FONT_SIZE / BRAND_FONT_SIZE / STACK_GAP** — typographic + layout scaling.
  - Constraints: items are the focal beat, sized 4-8× larger than eyebrow/footer
- **{bgColor} / {accentColor} / {textColor} / {dividerColor}** — semantic color tokens; accent reserved for the eyebrow and footer so the ticker items stay neutral.
- **{font}** — base typography stack. For numeric tickers add `font-variant-numeric: tabular-nums` so digit widths stay constant.

## Variations

### Numeric ticker (price / counter rolling)

Replace text items with the digit sequence and use the same spring-step pattern per decimal position (units, tens, hundreds...). Add `font-variant-numeric: tabular-nums` for digit-width stability.

### Reverse direction (counting down)

Swap the sign on the translate: `transform: translateY(${sumP * ITEM_HEIGHT}px)` and arrange items in reverse order. Reads as a countdown.

### Continuous infinite ticker (no settling)

Loop forever (e.g. news ticker) — use linear ease on a single long tween, duplicate the items list, reset when translation exceeds total height. NOT this rule — see [sine-wave-loop](sine-wave-loop.md) pattern for continuous motion vs this rule's discrete-step semantics.

### Pause between groups

For dramatic "spin then land" feel, group several fast spring steps (`STEP_SPACING` small) + a long `BRAND_DELAY`-style pause + a final dramatic step with bigger `BOUNCE_FACTOR`. The pause is where the eye locks in.

## Key Principles

- **Container height MUST equal item height** — otherwise items don't snap cleanly into the visible window. If container is 200px and items are 220px, every step shows a partial item edge above/below.
- **`overflow: hidden` on container, NOT on inner stack** — the mask is the window; the stack inside is free to extend below.
- **`flex-direction: column` on inner stack** — required for vertical stacking; row would make items horizontal.
- **Step spacing tighter than step duration** — overlap is what makes the springs additive and gives the "click click" cadence; non-overlapping steps read as a linear scroll.
- **`back.out` per step** — the overshoot is what makes each step feel like a "click." Linear ease or out-only ease loses the slot-machine feel.
- **Sum the springs in onUpdate, don't tween the final position directly** — this is the "additive" trick; each spring contributes its OWN snap, which is the slot-machine pacing.
- **❗ Don't update items via `innerHTML` between steps** — the ticker moves the SAME items via translate; replacing content makes the previous item visible AS the new one (broken illusion).
- **❗ Climax dwell ≥1s after final step** — see SKILL universal constraints.

## Critical Constraints

- **Timeline must be paused**: `gsap.timeline({ paused: true })`
- **Registry key = `data-composition-id`**
- **No CSS `transition`** on stack-inner — competes with the additive transform
- **`will-change: transform`** on stack-inner — many small transform updates per second
- **All items same height (pixel-exact)** — mismatched heights cause cumulative drift
- **For numeric: `font-variant-numeric: tabular-nums`** — variable digit widths break alignment

## Combinations

- [reactive-displacement.md](reactive-displacement.md) — ticker is "pushed" by an incoming element
- [scale-swap-transition.md](scale-swap-transition.md) — ticker scales out after settling on final state, scaled-in subtitle replaces it
- [press-release-spring.md](press-release-spring.md) — button press TRIGGERS the ticker spin

## Pairs with HF skills

- `/hyperframes-animation` — additive spring tweens via shared onUpdate
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
