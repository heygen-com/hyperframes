---
name: asr-keyword-glow
description: Highlight keywords with glow + scale synchronized to ASR word timestamps using an attack-sustain-release envelope. CSS custom property drives the glow; GSAP tweens the property through the envelope.
metadata:
  tags: asr, audio-sync, highlight, glow, keyword, text, speech, gsap, css-vars
  adapter: gsap
---

# ASR Keyword Glow

Words visually activate (glow + scale + color) when spoken, following an attack-sustain-release envelope synced to word-level ASR timestamps. After the word ends, glow drops to a low **rest level** so it stays slightly lit — a "breadcrumb trail" of spoken words.

## HyperFrames vs. Remotion

The Remotion version computed the envelope inline each render frame using `interpolate(frame, [...], [...])`. HyperFrames uses **a CSS custom property (`--glow`) on the keyword span** plus **two GSAP tweens per word** that move the property through the envelope. CSS calc expressions then drive `text-shadow` blur, `color`, and `scale` from `--glow`.

This decouples the _what to render_ (CSS) from _when_ (GSAP), and makes each word's animation a tiny, isolated unit.

```
Remotion: per-frame `if (frame >= start) progress = …`
HyperFrames: tl.to(span, { "--glow": 1 }, wordStart)      // attack
             tl.to(span, { "--glow": REST_LEVEL }, peakAt) // decay to rest
```

## Core Concept

Three-segment envelope per word, driven by **two chained GSAP tweens**:

1. **Attack** (0 → 1): linear ramp from word's ASR `start` to `peak` (midpoint)
2. **Decay** (1 → REST_LEVEL): from `peak` to `end + sustain`
3. **Rest** (= REST_LEVEL): held until end of composition (no further tween — GSAP leaves the value set)

```
   1.0  ─┐ peak
         │\
         │ \
         │  \
         │   \────────── REST_LEVEL (e.g. 0.14)
         │
   0.0  ─┘
        ↑   ↑              ↑
      start peak           rest forever
```

## Basic Pattern

```html
<h1 class="hero-title">
  <span class="kw" data-glow-start="0.12" data-glow-end="0.28">1</span>
  <span class="kw" data-glow-start="0.52" data-glow-end="0.72">long</span>
  <span class="kw" data-glow-start="0.78" data-glow-end="1.44">video,</span>
  <span class="kw" data-glow-start="1.48" data-glow-end="1.80">10</span>
  <span class="kw" data-glow-start="1.94" data-glow-end="2.22">viral</span>
  <span class="kw" data-glow-start="2.28" data-glow-end="2.80">clips.</span>
</h1>

<style>
  .kw {
    --glow: 0; /* GSAP tweens this */
    display: inline-block;
    color: hsl(48, calc(var(--glow) * 80%), calc(50% + var(--glow) * 5%));
    text-shadow:
      0 0 calc(var(--glow) * 20px) rgba(237, 203, 80, var(--glow)),
      0 0 calc(var(--glow) * 40px) rgba(237, 203, 80, calc(var(--glow) * 0.6));
    transform: scale(calc(1 + var(--glow) * 0.05));
    transition: color 0.15s linear; /* smooth the color step */
  }
</style>

<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  // ============================================================
  // ENVELOPE CONSTANTS
  // ============================================================
  const REST_LEVEL = 0.14; // residual glow after the word ends (range 0.1–0.3 — lower = subtler trail)
  const SUSTAIN_SECS = 0.5; // sustain after word ASR end before decay completes

  // ============================================================
  // BUILD A TWEEN PAIR PER KEYWORD
  // ============================================================
  document.querySelectorAll(".kw").forEach((kw) => {
    const start = Number(kw.dataset.glowStart);
    const end = Number(kw.dataset.glowEnd);
    const peak = start + (end - start) / 2;
    const restAt = end + SUSTAIN_SECS;

    // Attack — ramp from 0 to 1 between start and peak.
    tl.fromTo(
      kw,
      { "--glow": 0 },
      {
        "--glow": 1,
        duration: peak - start,
        ease: "power2.out", // soft attack — feels like a voice rising
      },
      start,
    );

    // Decay — fall from 1 to REST_LEVEL between peak and end+sustain.
    tl.to(
      kw,
      {
        "--glow": REST_LEVEL,
        duration: restAt - peak,
        ease: "power2.out",
      },
      peak,
    );
    // No tween after this — GSAP leaves --glow at REST_LEVEL until end.
  });

  window.__timelines["main"] = tl;
</script>
```

## Envelope Shape

The two-tween approach exactly reproduces the Remotion three-segment envelope:

| Segment | Frame range        | GSAP tween                                               |
| ------- | ------------------ | -------------------------------------------------------- |
| Attack  | start → peak       | `fromTo({"--glow":0}, {"--glow":1, ease: "power2.out"})` |
| Decay   | peak → end+sustain | `to({"--glow": REST_LEVEL, ease: "power2.out"})`         |
| Rest    | end+sustain → ∞    | No tween — GSAP holds the last set value                 |

If you want a **triangle** envelope (no rest level), set `REST_LEVEL = 0`. If you want a **plateau** (sustain at full glow), insert a third tween between attack and decay that holds at 1.

## Why CSS Custom Properties

GSAP can tween numeric CSS custom properties directly: `tl.to(el, { "--glow": 1 })`. This pattern wins over alternatives because:

- **One source of truth**: All visual effects (color, shadow, scale) derive from one variable. Changing the envelope changes everything in sync.
- **Cheap**: GPU-compositor-friendly. No `onUpdate` needed; the browser's CSS engine drives the renders.
- **Composable**: A pulsing glow can be added by a separate tween on `--pulse` and combined in CSS with `calc(var(--glow) * (1 + var(--pulse)))`.
- **Inspectable**: Use DevTools to scrub a frame and read `--glow` directly off the element. Easier to debug than reading interpolated state out of GSAP.

## Variations

### 3D Pop-Out Synced to Glow

Drive `translateZ` from the same `--glow`:

```css
.kw {
  transform: translateZ(calc(var(--glow) * 80px)) scale(calc(1 + var(--glow) * 0.05));
}
```

Requires `perspective` on a parent and `transform-style: preserve-3d` on the chain up to that parent.

### Per-Word Color (Different Accents per Keyword)

Add a per-word data attribute and read it in CSS:

```html
<span class="kw" data-glow-start="..." data-color="#ec2579">viral</span>
```

```css
.kw[data-color="#ec2579"] {
  --accent: #ec2579;
}
.kw {
  text-shadow: 0 0 calc(var(--glow) * 20px) var(--accent, #edcb50);
}
```

### Pulse-on-Active

While the word is glowing (≥ 0.5), pulse with a low-amplitude sine:

```js
// Pulse tween on a separate variable, started at attack peak.
tl.fromTo(
  kw,
  { "--pulse": 0 },
  { "--pulse": 1, duration: 0.6, ease: "sine.inOut", yoyo: true, repeat: 2 },
  peak,
);
```

And in CSS:

```css
.kw {
  text-shadow: 0 0 calc(var(--glow) * (15px + var(--pulse, 0) * 8px)) var(--accent);
}
```

## Critical Constraints

- **Two tweens per keyword, not one**: The attack and decay have different durations and ideally different eases. Don't try to express the whole envelope as one cubic-bezier ease — the rest plateau requires a separate sustain.
- **Rest level via the final tween's end value**: GSAP holds the last set value indefinitely. Don't add a third tween "to hold at REST_LEVEL" — it's unnecessary.
- **CSS `calc()` for derived effects**: Don't drive multiple GSAP tweens for shadow + scale + color. One `--glow` per word, all derivations in CSS.
- **`display: inline-block` on spans**: Required for `transform: scale()` to work on inline content.
- **Avoid `transition`** on tweened properties: A CSS `transition: text-shadow 0.2s` would double-animate against the GSAP tween. The brief `transition: color 0.15s linear` is OK if you want to soften the color jump, but skip it for tweened properties.
- **ASR timestamps in seconds, not frames**: HyperFrames is wall-clock. Convert from `frames / fps` if your source data is frame-indexed.
- **No `Math.random` / `Date.now`**: All envelopes are pure functions of `tl.time()`.

## Tips

- `SUSTAIN_SECS = 0.3–0.5` keeps the highlight visible just past the spoken word
- `REST_LEVEL = 0.1–0.3` depending on desired ambient glow strength (canonical example uses 0.14 for a subtle trail); `0` for a clean triangle
- `--glow * 20px` for noticeable but not blinding glow blur; max ~40px
- Scale boost: `* 0.03–0.08` — subtle emphasis
- `display: inline-block` is required for `transform` to work on `<span>`

## Combinations

- Pair with [3d-page-scroll](3d-page-scroll.md) — keywords on the scrolled page light up at their voiceover moments.
- Combine with [sine-wave-loop](sine-wave-loop.md) — pulse the active word via a second CSS variable.
- Use within [demo-page-scroll-spotlight](../blueprints/demo-page-scroll-spotlight.md) for the keyword-driven feature spotlight.

## Examples

- [demo-page-scroll-spotlight.html](../examples/demo-page-scroll-spotlight.html) — six title words (`1 long video, 10 viral clips.`) each glow at their ASR-anchored moment during Phase 1.
