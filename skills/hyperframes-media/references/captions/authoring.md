# Captions

Before authoring: confirm the transcript came from the right Whisper model. CLI default `small.en` silently translates non-English audio — see [`../transcribe.md`](../transcribe.md) → "Language Rule" and [`transcript-handling.md`](transcript-handling.md) for the mandatory quality check.

Analyze spoken content to determine caption style. If user specifies a style, use that. Otherwise, detect tone from the transcript.

## Transcript Source

```json
[
  { "id": "w0", "text": "Hello", "start": 0.0, "end": 0.5 },
  { "id": "w1", "text": "world.", "start": 0.6, "end": 1.2 }
]
```

`id` (`w0`, `w1`, …) is the stable reference for per-word overrides and is added by `hyperframes transcribe`. It's optional for backwards compatibility with hand-authored transcripts. See [`../transcribe.md`](../transcribe.md) → "Output Shape" for how this is produced, and [`transcript-handling.md`](transcript-handling.md) for cleanup before consumption.

## Style Detection (When No Style Specified)

Read the full transcript before choosing. Four dimensions:

**1. Visual feel** — corporate→clean; energetic→bold; storytelling→elegant; technical→precise; social→playful.

**2. Color palette** — dark+bright for energy; muted for professional; high contrast for clarity; one accent color.

**3. Font mood** — heavy/condensed for impact; clean sans for modern; rounded for friendly; serif for elegance.

**4. Animation character** — scale-pop for punchy; gentle fade for calm; word-by-word for emphasis; typewriter for technical.

## Per-Word Styling

Scan for words deserving distinct treatment:

- **Brand/product names** — larger size, unique color
- **ALL CAPS** — scale boost, flash, accent color
- **Numbers/statistics** — bold weight, accent color
- **Emotional keywords** — exaggerated animation (overshoot, bounce)
- **Call-to-action** — highlight, underline, color pop
- **Marker highlight** — for beyond-color emphasis (highlight sweep, circle, burst, scribble, sketchout), see `hyperframes-animation/rules/css-marker-patterns.md`.

## Script-to-Style Mapping

| Tone         | Font mood                | Animation                          | Color                       | Size    |
| ------------ | ------------------------ | ---------------------------------- | --------------------------- | ------- |
| Hype/launch  | Heavy condensed, 800-900 | Scale-pop, back.out(1.7), 0.1-0.2s | Bright on dark              | 72-96px |
| Corporate    | Clean sans, 600-700      | Fade+slide, power3.out, 0.3s       | White/neutral, muted accent | 56-72px |
| Tutorial     | Mono/clean sans, 500-600 | Typewriter/fade, 0.4-0.5s          | High contrast, minimal      | 48-64px |
| Storytelling | Serif/elegant, 400-500   | Slow fade, power2.out, 0.5-0.6s    | Warm muted tones            | 44-56px |
| Social       | Rounded sans, 700-800    | Bounce, elastic.out, word-by-word  | Playful, colored pills      | 56-80px |

## Word Grouping

- **High energy:** 2-3 words. Quick turnover.
- **Conversational:** 3-5 words. Natural phrases.
- **Measured/calm:** 4-6 words. Longer groups.

Break on sentence boundaries, 150ms+ pauses, or max word count.

## Positioning

- **Landscape (1920x1080):** Bottom 80-120px, centered
- **Portrait (1080x1920):** Lower middle ~600-700px from bottom, centered
- Never cover the subject's face
- `position: absolute` — never relative
- One caption group visible at a time

## Text Overflow Prevention

Use `window.__hyperframes.fitTextFontSize()`:

```js
var result = window.__hyperframes.fitTextFontSize(group.text.toUpperCase(), {
  fontFamily: "Outfit",
  fontWeight: 900,
  maxWidth: 1600,
});
el.style.fontSize = result.fontSize + "px";
```

Options: `maxWidth` (1600 landscape, 900 portrait), `baseFontSize` (78), `minFontSize` (42), `fontWeight`, `fontFamily`, `step` (2).

CSS safety nets: `max-width` on container, `overflow: visible` (**not** `hidden` — hidden clips scaled emphasis words and glow effects), `position: absolute`, explicit `height`. When per-word styling uses `scale > 1.0`, compute `maxWidth = safeWidth / maxScale` to leave headroom.

**Container pattern:** Full-width absolute container, centered. Do **not** use `left: 50%; transform: translateX(-50%)` — causes clipping at composition edges.

## Caption Exit Guarantee

Every group **must** have a hard kill after exit animation:

```js
tl.to(groupEl, { opacity: 0, scale: 0.95, duration: 0.12, ease: "power2.in" }, group.end - 0.12);
// `tl.set` is an instant flip, not a tween — safe to set `visibility` here (core's "no animating
// visibility" rule applies to tweens, which can't smoothly interpolate non-numeric values anyway).
tl.set(groupEl, { opacity: 0, visibility: "hidden" }, group.end);
```

Self-lint after building timeline — place **before** `window.__timelines[id] = tl` so it runs at composition init:

```js
GROUPS.forEach(function (group, gi) {
  var el = document.getElementById("cg-" + gi);
  if (!el) return;
  tl.seek(group.end + 0.01);
  var computed = window.getComputedStyle(el);
  if (computed.opacity !== "0" && computed.visibility !== "hidden") {
    console.warn(
      "[caption-lint] group " + gi + " still visible at t=" + (group.end + 0.01).toFixed(2) + "s",
    );
  }
});
tl.seek(0);
```

## Pre-Built Caption Components

Before building caption styles from scratch, check the registry — 15 ready-to-use caption components cover the most common styles. Install with `npx hyperframes add <name>` and wire as a sub-composition via `data-composition-src` (see `hyperframes-registry`).

```bash
npx hyperframes catalog --tag caption-style   # list all caption components
npx hyperframes add caption-highlight         # install a specific one
```

| Style                     | Component                    | Best for                     |
| ------------------------- | ---------------------------- | ---------------------------- |
| TikTok-style highlight    | `caption-highlight`          | Social, high-energy          |
| Karaoke pill              | `caption-pill-karaoke`       | Music, lyric videos          |
| Cinematic editorial       | `caption-editorial-emphasis` | Documentary, storytelling    |
| Glitch / cyber            | `caption-glitch-rgb`         | Tech, gaming                 |
| Full-screen slam          | `caption-kinetic-slam`       | Hype, announcements          |
| Neon glow                 | `caption-neon-glow`          | Night, club, neon aesthetics |
| Neon accent (multi-color) | `caption-neon-accent`        | Colorful, playful            |
| Wipe reveal               | `caption-clip-wipe`          | Clean, modern                |
| Gradient fill             | `caption-gradient-fill`      | Vibrant, eye-catching        |
| Matrix decode             | `caption-matrix-decode`      | Sci-fi, tech reveals         |
| Emoji pop                 | `caption-emoji-pop`          | Social, casual               |
| Parallax layers           | `caption-parallax-layers`    | Depth, cinematic             |
| Particle burst            | `caption-particle-burst`     | Celebration, impact keywords |
| Lava texture              | `caption-texture`            | Bold, dramatic               |
| Weight shift              | `caption-weight-shift`       | Elegant, typographic         |

Related: `caption-blend-difference` (tagged `text` / `blend-mode`, not `caption-style`, so it won't appear under the filter above) auto-inverts text against any background via `mix-blend-mode: difference` — useful when the background is busy or unpredictable.

Browse all with previews: [hyperframes.heygen.com/catalog](https://hyperframes.heygen.com/catalog)

Caption components ship with transparent backgrounds — they're pure overlays. If the underlying video is bright or busy, add a contrast layer (e.g. a semi-transparent dark div) in the host composition beneath the caption sub-composition, not inside the component itself.

## Further References

- [`motion.md`](motion.md) — karaoke, marker effects, audio-reactive modulation, scatter exits.
- [`transcript-handling.md`](transcript-handling.md) — input formats, quality checks, cleaning, external API fallback.
- `hyperframes-animation/rules/css-marker-patterns.md` — marker highlighting (deterministic, fully seekable).

## Constraints

- Deterministic. No `Math.random()`, no `Date.now()`.
- Sync to transcript timestamps.
- One group visible at a time.
- Every group must have a hard `tl.set` kill at `group.end`.
- Fonts: the compiler auto-embeds only its **built-in mapped set** (Inter, Roboto, Montserrat, …) — for those, just declare `font-family` in CSS. Any **other** font (a brand/custom font like `TT Norms Pro`, or a non-Latin CJK/Devanagari family) is **not** auto-supplied: it needs an `@font-face` pointing at a real `.woff2` shipped with the project, or the text silently falls back to a generic font in the render. Don't assume a `font-family` you can see locally will render — the render machine is a clean headless Chrome with no installed fonts.
