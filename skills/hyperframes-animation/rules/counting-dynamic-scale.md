---
name: counting-dynamic-scale
description: Counter animation where font size grows in lockstep with the counting value, driven by a single GSAP tween in HyperFrames.
metadata:
  tags: counter, counting, scale, font-size, number, dynamic, emphasis, gsap
  adapter: gsap
---

# Counting with Dynamic Scale

A number counts from A to B while its font size simultaneously grows. The two animate from the same eased progress so the visual weight grows alongside the magnitude — "this number is impressive."

## HyperFrames Translation Notes

The Remotion version interpolated `frame → progress → (number, fontSize)` inline every render.

HyperFrames uses **a single GSAP tween on a proxy object** whose `onUpdate` writes `textContent` and the `font-size` CSS property. The proxy makes both the displayed number and the size pure functions of timeline time — safe to seek backwards.

> An alternative is `gsap.to({}, { duration, onUpdate })` reading `this.progress()`. Either form works; the proxy form is more readable.

## Basic Pattern

```html
<div class="count-wrap">
  <span class="count" style="font-variant-numeric: tabular-nums; font-weight: 900;">0</span>
  <span class="count-suffix" style="opacity: 0;">M+</span>
</div>

<style>
  .count-wrap {
    display: inline-flex;
    align-items: baseline;
    gap: 0.05em;
    width: 600px; /* fixed width prevents layout shift as digits grow */
    justify-content: center;
    overflow: hidden;
  }
  .count,
  .count-suffix {
    color: var(--accent, #00ff88);
    line-height: 1;
  }
</style>

<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  // ============================================================
  // CONSTANTS
  // ============================================================
  const START_VALUE = 0;
  const END_VALUE = 12;
  const COUNT_START = 0.4; // seconds
  const COUNT_DUR = 0.85;
  const VIEWPORT_W = 1920;
  const START_SCALE = 0.2; // initial font size as fraction of viewport width
  const END_SCALE = 0.42; // final font size as fraction of viewport width

  const countEl = document.querySelector(".count");
  const suffixEl = document.querySelector(".count-suffix");

  // Set initial style before the timeline runs.
  gsap.set(countEl, { fontSize: VIEWPORT_W * START_SCALE });
  gsap.set(suffixEl, { fontSize: VIEWPORT_W * END_SCALE });

  // A proxy object tweens the underlying scalar. onUpdate reads it and
  // derives both textContent and fontSize. Easing on the proxy = easing
  // on both outputs simultaneously.
  const proxy = { p: 0 };

  tl.to(
    proxy,
    {
      p: 1,
      duration: COUNT_DUR,
      ease: "power2.out", // 2.5x easeOut → power2.5.out approximates with power2/power3
      onUpdate: () => {
        const p = proxy.p;
        const value = Math.round(START_VALUE + (END_VALUE - START_VALUE) * p);
        const fontPx = VIEWPORT_W * (START_SCALE + (END_SCALE - START_SCALE) * p);
        countEl.textContent = value;
        countEl.style.fontSize = fontPx + "px";
      },
    },
    COUNT_START,
  );

  // Suffix pops in after the count completes.
  tl.to(
    suffixEl,
    {
      opacity: 1,
      duration: 0.3,
      ease: "back.out(1.6)",
    },
    COUNT_START + COUNT_DUR,
  );

  window.__timelines["main"] = tl;
</script>
```

## Easing Mapping

The Remotion source used a custom `1 - Math.pow(1 - p, easePower)` curve with `easePower = 2.5` (between `power2.out` and `power3.out`).

| `easePower` | GSAP equivalent                                                                    | Feel                                           |
| ----------- | ---------------------------------------------------------------------------------- | ---------------------------------------------- |
| 1.0         | `none`                                                                             | Linear, constant speed                         |
| 2.0         | `power2.out`                                                                       | Soft deceleration                              |
| 2.5         | `power2.out` (close enough) — or `CustomEase.create("e", "M0,0 C0.3,1 0.4,1 1,1")` | Recommended — dramatic deceleration            |
| 3.0         | `power3.out`                                                                       | Very dramatic — number almost stops at the end |

For most cases `power2.out` matches the source feel within imperceptible difference. Use `CustomEase` only if you need to match a specific curve exactly.

## Layout Stability

**Critical**: `font-variant-numeric: tabular-nums` prevents layout shift as digit count changes (single-digit → double-digit → triple-digit). Without it, "9" is narrower than "90", which is narrower than "100", causing visible jitter.

For additional stability, wrap in a fixed-width container with `overflow: hidden`:

```css
.count-wrap {
  width: 600px;
  overflow: hidden;
  text-align: center;
}
```

The element grows in place, never bouncing.

## Critical Constraints

- **Tween a proxy, not the DOM directly**: GSAP can't tween `textContent` numerically. The proxy is the standard pattern.
- **Round in onUpdate**: Otherwise you display `7.3489271`. Use `Math.round()` or `.toFixed(0)` for integers.
- **Tabular nums or fixed width**: One of these. Otherwise digits jitter horizontally.
- **End scale comfortable**: `END_SCALE × VIEWPORT_W` should fit horizontally even at the longest digit count. For 1920 width and a 4-digit max, 0.18 × 1920 = 345 px feels safe.
- **No `Date.now()` inside `onUpdate`**: The onUpdate must derive from `proxy.p` only — a pure function of tween progress.

## Variations

### 3D Entry

Add a `translateZ` entry to give the counter depth:

```js
tl.from(
  ".count-wrap",
  {
    z: -300, // GSAP transform alias for translateZ
    opacity: 0,
    duration: 0.5,
    ease: "back.out(1.4)",
  },
  COUNT_START,
);

// Parent of .count-wrap needs `perspective: 1000px` for the Z translate to read as depth.
```

### Sustain Loop After Final Value

To "hold" the final value visibly for the rest of the composition, you don't need a tween — the final state of the proxy persists. If you want a subtle pulse, append a finite yoyo:

```js
tl.to(
  ".count",
  {
    scale: 1.05,
    duration: 0.6,
    ease: "sine.inOut",
    repeat: 2,
    yoyo: true,
  },
  COUNT_START + COUNT_DUR + 0.4,
);
```

## Tips

- `START_SCALE`: 0.15–0.25 of viewport width feels right.
- `END_SCALE`: 0.35–0.50 of viewport width — large but doesn't clip horizontally.
- Position the counter so the number stays anchored in place as it grows. Center-baseline anchoring works best.
- For the suffix (`%`, `+`, `M`), keep its font size constant and animate only opacity. Animating both feels chaotic.

## Combinations

- Pair with [avatar-cloud-network](avatar-cloud-network.md) — counter sits above the cloud center, both share the same authority moment.
- Combine with [coordinate-target-zoom](coordinate-target-zoom.md) for a "push into the number" reveal.

## Examples

- [proof-logo-chain.html](../examples/proof-logo-chain.html) — `12M+` counter pinned above the avatar-cloud center.
