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
    <span class="word" data-word="Ship">Ship</span>
    <span class="word" data-word="a">a</span>
    <span class="word" data-word="video">video</span>
    <span class="word" data-word="in">in</span>
    <span class="word" data-word="one">one</span>
    <span class="word" data-word="prompt">prompt</span>
    <span class="word brand" data-word="HEYGENVERSE">HEYGENVERSE</span>
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
  font-family: "Inter", sans-serif;
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
  color: #f5f6fb;
  text-align: center;
  line-height: 1.2;
}
.word {
  display: inline-block;
  transform-origin: 50% 50%;
  /* Initial subtle rest glow */
  text-shadow: 0 0 0 rgba(167, 139, 250, 0);
  will-change: transform, text-shadow;
}
.word.brand {
  color: #cdb8ff;
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

  // Per-word "spoken" times — author these to control narrator pacing
  // For "Ship a video in one prompt — HEYGENVERSE"
  const TIMINGS = {
    Ship: { start: 0.4, end: 0.9 },
    a: { start: 0.95, end: 1.1 },
    video: { start: 1.15, end: 1.6 },
    in: { start: 1.7, end: 1.85 },
    one: { start: 1.9, end: 2.2 },
    prompt: { start: 2.25, end: 2.9 },
    HEYGENVERSE: { start: 3.5, end: 5.0 }, // long emphasis on brand
  };

  const RELEASE = 0.3; // seconds for decay after end
  const REST_LEVEL = 0.25;
  const MAX_BLUR = 22; // px
  const MAX_SCALE_BOOST = 0.08; // scale 1.0 → 1.08 at peak

  function envelope(time, start, end) {
    const releaseEnd = end + RELEASE;
    if (time < start) return 0;
    if (time < end) {
      // attack — linear ramp first 0.15s then sustain
      const attack = Math.min((time - start) / 0.15, 1);
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
      t: 6.0,
      duration: 6.0,
      ease: "none",
      onUpdate: () => {
        words.forEach((el) => {
          const word = el.dataset.word;
          const timing = TIMINGS[word];
          if (!timing) return;
          const env = envelope(driver.t, timing.start, timing.end);
          const blur = MAX_BLUR * env;
          const scale = 1 + MAX_SCALE_BOOST * env;
          const color = el.classList.contains("brand") ? "167, 139, 250" : "167, 139, 250";
          el.style.textShadow = `0 0 ${blur}px rgba(${color}, ${0.4 + env * 0.5})`;
          el.style.transform = `scale(${scale})`;
        });
      },
    },
    0,
  );

  window.__timelines["asr-scene"] = tl;
</script>
```

## Variations

### Multi-octave glow (more dramatic peaks)

Combine the envelope-driven blur with a sin pulse during the sustain phase — high-emphasis words breathe at peak:

```js
const sustain = env * (1 + Math.sin(driver.t * 8) * 0.2);
const blur = MAX_BLUR * sustain;
```

### Color shift on the peak

The active word shifts hue from white → brand purple at peak, settles back to white at rest:

```js
const r = Math.round(245 + (167 - 245) * env);
const g = Math.round(246 + (139 - 246) * env);
const b = Math.round(251 + (250 - 251) * env);
el.style.color = `rgb(${r}, ${g}, ${b})`;
```

### Karaoke style (dim-rest + bright-active, RECOMMENDED for video narration)

Default amplitudes (`MAX_BLUR=22`, `MAX_SCALE_BOOST=0.08`, rest text full white) read as too subtle in video — the inactive words still dominate. Karaoke style fixes this: **inactive words rendered DIM (e.g. `#4a4f6b` slate)**, active words **lerp toward bright white + larger scale**:

```js
const REST_RGB = { r: 74, g: 79, b: 107 }; // dim slate
const ACTIVE_RGB = { r: 245, g: 246, b: 251 }; // white
const BRAND_RGB = { r: 205, g: 184, b: 255 }; // brand purple

const MAX_BLUR = 36; // bumped from 22
const MAX_SCALE_BOOST = 0.22; // bumped from 0.08 — 22% size jump reads as karaoke pop
const REST_LEVEL = 0.18; // dim rest, not 0.3

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}
function colorAt(env, isBrand) {
  const target = isBrand ? BRAND_RGB : ACTIVE_RGB;
  return `rgb(${lerp(REST_RGB.r, target.r, env)}, ${lerp(REST_RGB.g, target.g, env)}, ${lerp(REST_RGB.b, target.b, env)})`;
}

// In onUpdate:
el.style.color = colorAt(env, el.classList.contains("brand"));
```

Visual result: at any moment 1-2 words are bright + glowing (the spoken word + the recently-spoken one's lingering rest), and the rest of the phrase is dim. This is closer to actual karaoke / lyric video aesthetic than the subtle "everyone half-glowing" baseline.

When to use karaoke vs default: short narration phrases (5-10 words) where one word at a time should clearly POP → karaoke. Long dense text where many words emphasize subtly → default subtle.

### 3D pop-out

Combine envelope with `translateZ` for words to "lean toward camera" as they speak:

```js
const popZ = env * 40;
el.style.transform = `translateZ(${popZ}px) scale(${scale})`;
```

Requires `perspective` on the parent.

### From real ASR transcripts

For real ASR-driven scenes, replace hardcoded TIMINGS with transcript JSON (each entry has `word`, `start_ms`, `end_ms`). Convert to seconds and feed in identically.

## Key Principles

- **Envelope shape: attack-sustain-decay-rest** — never zero out after a word. The rest level (0.2-0.4) keeps the recently-spoken words subtly highlighted, creating a "breadcrumb" of attention.
- **Brand word gets longer emphasis (1.5-2x normal)** — the brand is the headline; let it sustain.
- **`display: inline-block`** on each word — required for `transform` to apply to `<span>`.
- **Max blur 15-25px, max scale-boost 0.03-0.08** — bigger and the word becomes "bouncy" rather than "emphasized."
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

- `/hyperframes-gsap` — single driver, multi-element envelope
- `/hyperframes-media` — `hyperframes transcribe` outputs real ASR data
- `/hyperframes-captions` — pair with caption rendering
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
