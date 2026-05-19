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
    <div class="eyebrow">YOUR ROLE</div>
    <div class="ticker" id="ticker">
      <div class="stack-inner" id="stack-inner">
        <div class="item">CREATOR</div>
        <div class="item">DESIGNER</div>
        <div class="item">PM</div>
        <div class="item">DEV</div>
        <div class="item">FOUNDER</div>
      </div>
    </div>
    <div class="brand">— BUILT WITH HEYGENVERSE</div>
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
  background: radial-gradient(ellipse at center, #161a3a 0%, #0b0d1f 70%);
  font-family: "Inter", sans-serif;
}
.stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 32px;
}
.eyebrow {
  font-size: 32px;
  font-weight: 800;
  letter-spacing: 14px;
  text-transform: uppercase;
  color: #cdb8ff;
}
/* MANDATORY: container height matches the per-item height exactly */
.ticker {
  width: 1100px;
  height: 200px;
  overflow: hidden;
  border-top: 2px solid rgba(167, 139, 250, 0.3);
  border-bottom: 2px solid rgba(167, 139, 250, 0.3);
  position: relative;
}
.stack-inner {
  display: flex;
  flex-direction: column; /* MANDATORY for vertical ticker */
  will-change: transform;
}
.item {
  height: 200px; /* MUST equal .ticker height */
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 160px;
  font-weight: 900;
  letter-spacing: 8px;
  text-transform: uppercase;
  color: #f5f6fb;
  /* font-variant-numeric: tabular-nums; — for numeric tickers */
}
.brand {
  font-size: 40px;
  font-weight: 800;
  letter-spacing: 10px;
  color: #a78bfa;
  text-transform: uppercase;
}
```

## GSAP Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  const ITEM_HEIGHT = 200;
  const STEPS = 4; // jump from item 0 ("CREATOR") to item 4 ("FOUNDER") = 4 steps
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
        duration: 0.5,
        ease: "back.out(1.8)", // spring with overshoot
        onUpdate: applyTransform,
      },
      0.4 + i * 0.4,
    ); // 0.4s start + 0.4s between steps
  });

  // Brand reveals after the ticker settles on FOUNDER
  tl.from(
    ".brand",
    { opacity: 0, y: 12, duration: 0.5, ease: "power3.out" },
    0.4 + STEPS * 0.4 + 0.3, // ~0.3s after final step lands
  );

  window.__timelines["ticker-scene"] = tl;
</script>
```

## Variations

### Numeric ticker (price / counter rolling)

For a $0 → $5,000 numeric ticker, replace text items with the digit sequence and use the same spring-step pattern per decimal position (units, tens, hundreds...). Add `font-variant-numeric: tabular-nums` for digit-width stability.

### Reverse direction (counting down)

Swap the sign on the translate: `transform: translateY(${sumP * ITEM_HEIGHT}px)` and arrange items in reverse order. Reads as a countdown.

### Continuous infinite ticker (no settling)

Loop forever (e.g. news ticker) — use linear ease on a single long tween, duplicate the items list, reset when translation exceeds total height. NOT this rule — see [sine-wave-loop](sine-wave-loop.md) pattern for continuous motion vs this rule's discrete-step semantics.

### Pause between groups

For dramatic "spin then land" feel, group 3 fast spring steps (0.15s apart) + 0.8s pause + final dramatic step with bigger overshoot (`back.out(2.5)`). The pause is where the eye locks in.

## Key Principles

- **Container height MUST equal item height** — otherwise items don't snap cleanly into the visible window. If container is 200px and items are 220px, every step shows a partial item edge above/below.
- **`overflow: hidden` on container, NOT on inner stack** — the mask is the window; the stack inside is free to extend below.
- **`flex-direction: column` on inner stack** — required for vertical stacking; row would make items horizontal.
- **Springs spaced 0.3-0.5s apart** — closer and the steps blur together (looks like linear scroll); further and the ticker feels lazy.
- **`back.out(1.6-2.0)` per step** — the overshoot is what makes each step feel like a "click." Linear ease or out-only ease loses the slot-machine feel.
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

- `/hyperframes-gsap` — additive spring tweens via shared onUpdate
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
