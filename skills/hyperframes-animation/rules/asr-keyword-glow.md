---
name: asr-keyword-glow
description: Keywords glow + scale up when "spoken" — attack/sustain/release envelope synced to per-word timestamps. Even without real audio, hardcoded timings create a "narrator emphasis" effect.
metadata:
  tags: asr, audio-sync, highlight, glow, keyword, text, speech, emphasis
---

# ASR Keyword Glow

Words in a phrase visually activate (glow blur + scale) when "spoken," following an attack-sustain-release (ASR-like) envelope. In a real ASR pipeline these timings come from word-level transcript data; for promotional video, hardcode the timings to control emphasis pacing. The envelope leaves a subtle "rest glow" after the word, creating a breadcrumb of recent emphasis.

## How It Works

Each word has `{ start, end }` timestamps. At each frame, compute the word's envelope value:

- **Pre-start** → 0 (not yet)
- **Start → peak** → attack (linear ramp 0 → 1)
- **Peak → end** → sustain (stays at 1)
- **End → end+release** → decay (1 → restLevel, typically 0.25)
- **After release** → restLevel (stays subtly highlighted)

The envelope drives `textShadow` blur radius AND `scale`. Higher blur + bigger scale = "speaking" emphasis.

## HTML

```html
<div
  class="scene"
  id="asr-scene"
  data-composition-id="asr-scene"
  data-start="0"
  data-duration="6"
  data-track-index="0"
>
  <div class="phrase">
    <!-- One <span class="word"> per word in {phrase}. data-word is a
         stable key used to look up the word's ASR timing in JS. The
         final word may be a {brandWord}, which gets longer emphasis
         and the .brand modifier. -->
    <span class="word" data-word="{w1Key}">{w1}</span>
    <span class="word" data-word="{w2Key}">{w2}</span>
    <!-- … -->
    <span class="word brand" data-word="{brandKey}">{brandWord}</span>
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
  background: {sceneBackgroundColor};
  font-family: {font};
}
.phrase {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
  justify-content: center;
  max-width: 1700px;
  font-size: 120px;
  font-weight: 900;
  letter-spacing: 2px;
  color: {restColor};
  text-align: center;
  line-height: 1.2;
}
.word {
  display: inline-block;
  transform-origin: 50% 50%;
  /* Initial subtle rest glow */
  text-shadow: 0 0 0 {glowColorTransparent};
  will-change: transform, text-shadow;
}
.word.brand {
  color: {brandAccentColor};
  letter-spacing: 12px;
  text-transform: uppercase;
}
```

## GSAP Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  // Per-word "spoken" times — author these to control narrator pacing.
  // Shape: { [wordKey]: { start, end } } in local seconds. One entry
  // per <span class="word" data-word="…">. The brand word's window is
  // typically 1.5-2× as long as a normal word.
  const TIMINGS = {
    // {w1Key}: { start: …, end: … },
    // {w2Key}: { start: …, end: … },
    // …
    // {brandKey}: { start: …, end: … },
  };

  function envelope(time, start, end) {
    const releaseEnd = end + RELEASE;
    if (time < start) return 0;
    if (time < end) {
      // attack — linear ramp over ATTACK_DUR then sustain
      const attack = Math.min((time - start) / ATTACK_DUR, 1);
      return attack;
    }
    if (time < releaseEnd) {
      // decay to rest level
      const decay = (time - end) / RELEASE;
      return 1 - decay * (1 - REST_LEVEL);
    }
    return REST_LEVEL;
  }

  const words = document.querySelectorAll(".word");

  // Single driver — 0 → composition duration
  const driver = { t: 0 };
  tl.to(
    driver,
    {
      t: SCENE_DURATION,
      duration: SCENE_DURATION,
      ease: "none",
      onUpdate: () => {
        words.forEach((el) => {
          const word = el.dataset.word;
          const timing = TIMINGS[word];
          if (!timing) return;
          const env = envelope(driver.t, timing.start, timing.end);
          const blur = MAX_BLUR * env;
          const scale = 1 + MAX_SCALE_BOOST * env;
          el.style.textShadow = `0 0 ${blur}px ${glowColorRgba(env)}`;
          el.style.transform = `scale(${scale})`;
        });
      },
    },
    0,
  );

  window.__timelines["asr-scene"] = tl;
</script>
```

`glowColorRgba(env)` returns the brand glow color with `env`-modulated alpha (e.g. `rgba({glowR}, {glowG}, {glowB}, ${GLOW_ALPHA_BASE + env * GLOW_ALPHA_RANGE})`).

## Variations

### Multi-octave glow (more dramatic peaks)

Combine the envelope-driven blur with a sin pulse during the sustain phase — high-emphasis words breathe at peak. The sine frequency `PULSE_HZ` controls how many breaths fit in the sustain window; amplitude `PULSE_AMPLITUDE` controls how visible the breath is.

```js
const sustain = env * (1 + Math.sin(driver.t * PULSE_HZ) * PULSE_AMPLITUDE);
const blur = MAX_BLUR * sustain;
```

### Color shift on the peak

The active word lerps from `restColor` → `peakColor` as `env` rises, settling back to `restColor` at rest:

```js
function lerpChannel(a, b, t) {
  return Math.round(a + (b - a) * t);
}
el.style.color = `rgb(${lerpChannel(REST_RGB.r, PEAK_RGB.r, env)}, ${lerpChannel(REST_RGB.g, PEAK_RGB.g, env)}, ${lerpChannel(REST_RGB.b, PEAK_RGB.b, env)})`;
```

### Karaoke style (dim-rest + bright-active, RECOMMENDED for video narration)

Default amplitudes (small MAX_BLUR, small MAX_SCALE_BOOST, rest text full white) read as too subtle in video — the inactive words still dominate. Karaoke style fixes this: **inactive words rendered DIM**, active words **lerp toward bright white + larger scale**:

```js
// Tunable constants — see How to Choose Values
// REST_RGB    — dim color for inactive words
// ACTIVE_RGB  — bright color at peak (non-brand)
// BRAND_RGB   — bright color at peak (brand word)
// MAX_BLUR, MAX_SCALE_BOOST, REST_LEVEL all pushed higher than default

function lerpChannel(a, b, t) {
  return Math.round(a + (b - a) * t);
}
function colorAt(env, isBrand) {
  const target = isBrand ? BRAND_RGB : ACTIVE_RGB;
  return `rgb(${lerpChannel(REST_RGB.r, target.r, env)}, ${lerpChannel(REST_RGB.g, target.g, env)}, ${lerpChannel(REST_RGB.b, target.b, env)})`;
}

// In onUpdate:
el.style.color = colorAt(env, el.classList.contains("brand"));
```

Visual result: at any moment 1-2 words are bright + glowing (the spoken word + the recently-spoken one's lingering rest), and the rest of the phrase is dim. This is closer to actual karaoke / lyric video aesthetic than the subtle "everyone half-glowing" baseline.

When to use karaoke vs default: short narration phrases (5-10 words) where one word at a time should clearly POP → karaoke. Long dense text where many words emphasize subtly → default subtle. Karaoke pushes MAX_BLUR, MAX_SCALE_BOOST, and contrast between REST_RGB and ACTIVE_RGB; everything else is identical.

### 3D pop-out

Combine envelope with `translateZ` for words to "lean toward camera" as they speak:

```js
const popZ = env * MAX_POP_Z;
el.style.transform = `translateZ(${popZ}px) scale(${scale})`;
```

Requires `perspective` on the parent.

### From real ASR transcripts

For real ASR-driven scenes, replace hardcoded TIMINGS with transcript JSON (each entry has `word`, `start_ms`, `end_ms`). Convert to seconds and feed in identically. The shape `{ [wordKey]: { start, end } }` is the same whether hand-authored or derived from `hyperframes transcribe`.

## How to Choose Values

- **TIMINGS** — per-word `{ start, end }` map. Author one entry per `.word` span.
  - Shape: `{ wordKey: { start: number, end: number } }`, all seconds local to the scene.
  - Constraints: monotonic non-overlap — every entry's `end < next entry's start` (overlapping windows make the envelope ambiguous).
  - Brand word window: typically 1.5-2× the average non-brand word window so the brand sustains.
- **ATTACK_DUR** — seconds for the envelope to ramp 0 → 1 once a word starts.
  - Range: 0.1-0.25 s
  - Effects: shorter feels punchy and ASR-like; longer feels smoothed-out.
  - Constraints: must be < (smallest word's end - start), otherwise the word never reaches 1.
- **RELEASE** — seconds for the envelope to decay 1 → REST_LEVEL after a word ends.
  - Range: 0.2-0.5 s
- **REST_LEVEL** — held envelope value after RELEASE.
  - Range: 0.15-0.4 (default style); 0.05-0.2 (karaoke style — dimmer rest).
  - Effects: lower = quieter breadcrumb; higher = more recently-spoken words stay bright.
  - Constraints: must be < 1; should be > 0 to preserve the breadcrumb.
- **MAX_BLUR** — peak `text-shadow` blur radius in px.
  - Range: 15-25 px (default style); 30-45 px (karaoke style).
  - Effects: bigger reads as "shouting"; smaller reads as "neutral narration".
- **MAX_SCALE_BOOST** — additive scale at peak (e.g. 0.08 ⇒ 1.0 → 1.08).
  - Range: 0.03-0.10 (default style); 0.15-0.25 (karaoke style).
  - Effects: bigger reads as "bouncy"; smaller reads as "just glowing".
- **SCENE_DURATION** — total seconds for the single driver tween.
  - Constraints: must equal the scene's `data-duration` so the driver `t` reaches the end of TIMINGS in sync with HF's seek.
- **REST_RGB / ACTIVE_RGB / BRAND_RGB** (karaoke style) — discrete color choices, not numeric.
  - REST_RGB: dim tone of the brand palette's neutral; should read as off-white-ish dim, not black.
  - ACTIVE_RGB: brand text color at full readability.
  - BRAND_RGB: brand accent color (often the same hue as the glow).
- **PULSE_HZ / PULSE_AMPLITUDE** (multi-octave variation) — sine breath frequency / depth.
  - PULSE_HZ range: 4-10 rad/s; PULSE_AMPLITUDE range: 0.1-0.3.
- **MAX_POP_Z** (3D pop-out variation) — max Z translation at peak (px).
  - Range: 20-60 px; requires parent `perspective`.

Ease family — discrete choice:

- Single linear driver (`ease: "none"`) so `t` maps 1:1 to scene time. Any other ease distorts the per-word envelope shape — do not change.

## Key Principles

- **Envelope shape: attack-sustain-decay-rest** — never zero out after a word. The rest level (REST_LEVEL > 0) keeps the recently-spoken words subtly highlighted, creating a "breadcrumb" of attention.
- **Brand word gets longer emphasis (1.5-2× normal)** — the brand is the headline; let it sustain.
- **`display: inline-block`** on each word — required for `transform` to apply to `<span>`.
- **MAX_BLUR and MAX_SCALE_BOOST stay in their default-style ranges unless you commit to karaoke** — picking values between default and karaoke yields awkward "half-loud" emphasis.
- **Per-word `text-shadow`** (not `box-shadow`) — text-shadow is the glow around the GLYPH, which is what reads as "speaking emphasis." Box-shadow would glow around the inline-block bounding box (rectangle).
- **Single driver, multi-word onUpdate** — one tween that loops over all words. Don't create one tween per word — at 60+ words the timeline becomes unwieldy.
- **❗ Climax dwell ≥1s** — after the final word's emphasis, comp continues ≥1s. The last word IS the headline beat.

## Critical Constraints

- **Timeline must be paused**: `gsap.timeline({ paused: true })`
- **Registry key = `data-composition-id`**
- **No CSS animation** on word elements
- **`display: inline-block`** on each `.word`
- **`will-change: transform, text-shadow`** on `.word`
- **Timings monotonic** (later start > earlier end) — overlapping words mess up the envelope

## Combinations

- [3d-text-depth-layers.md](3d-text-depth-layers.md) — the active word gets depth-layered emphasis at peak
- [sine-wave-loop.md](sine-wave-loop.md) — non-active words breathe subtly between emphasis moments
- [context-sensitive-cursor.md](context-sensitive-cursor.md) — typewriter that types each word matching the ASR cadence

## Pairs with HF skills

- `/hyperframes-animation` — single driver, multi-element envelope
- `/hyperframes-media` — `hyperframes transcribe` outputs real ASR data
- `/hyperframes-media` — pair with caption rendering
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
