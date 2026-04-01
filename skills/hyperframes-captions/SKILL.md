---
name: hyperframes-captions
description: Build tone-adaptive captions from whisper transcripts. Detects script energy (hype, corporate, tutorial, storytelling, social) and applies matching typography, color, and animation. Supports per-word styling for brand names, ALL CAPS, numbers, and CTAs. Use when adding captions, subtitles, or lyrics to a HyperFrames composition. Lyric videos ARE captions — any text synced to audio uses this skill.
trigger: Use this skill whenever a task involves syncing text to audio timing. This includes captions, subtitles, lyrics, karaoke, transcription overlays, and any word-level or phrase-level text timed to speech or music.
---

# Captions

Analyze the spoken content to determine caption style. If the user specifies a style, use that. Otherwise, detect tone from the transcript.

## Transcript Source

The project's `transcript.json` contains a normalized word array with word-level timestamps:

```json
[
  { "text": "Hello", "start": 0.0, "end": 0.5 },
  { "text": "world.", "start": 0.6, "end": 1.2 }
]
```

This is the only format the captions composition consumes. Use it directly:

```js
const words = JSON.parse(transcriptJson); // [{ text, start, end }]
```

For transcription commands, whisper model selection, external APIs (OpenAI, Groq), and supported input formats, see [transcript-guide.md](./transcript-guide.md). **After every transcription, read the transcript and run the quality check** — bad transcripts (music tokens, garbled words) must be retried with a larger model before proceeding.

## Style Detection (Default — When No Style Is Specified)

Read the full transcript before choosing a style. The style comes from the content, not a template.

### Four Dimensions

**1. Visual feel** — the overall aesthetic personality:

- Corporate/professional scripts → clean, minimal, restrained
- Energetic/marketing scripts → bold, punchy, high-impact
- Storytelling/narrative scripts → elegant, warm, cinematic
- Technical/educational scripts → precise, high-contrast, structured
- Social media/casual scripts → playful, dynamic, friendly

**2. Color palette** — driven by the content's mood:

- Dark backgrounds with bright accents for high energy
- Muted/neutral tones for professional or calm content
- High contrast (white on black, black on white) for clarity
- One accent color for emphasis — not multiple

**3. Font mood** — typography character, not specific font names:

- Heavy/condensed for impact and energy
- Clean sans-serif for modern and professional
- Rounded for friendly and approachable
- Serif for elegance and storytelling

**4. Animation character** — how words enter and exit:

- Scale-pop/slam for punchy energy
- Gentle fade/slide for calm or professional
- Word-by-word reveal for emphasis
- Typewriter for technical or narrative pacing

## Per-Word Styling

Scan the script for words that deserve distinct visual treatment. Not every word is equal — some carry the message.

### What to Detect

- **Brand names / product names** — larger size, unique color, distinct entrance
- **ALL CAPS words** — the author emphasized them intentionally. Scale boost, flash, or accent color.
- **Numbers / statistics** — bold weight, accent color. Numbers are the payload in data-driven content.
- **Emotional keywords** — "incredible", "insane", "amazing", "revolutionary" → exaggerated animation (overshoot, bounce)
- **Proper nouns** — names of people, places, events → distinct accent or italic
- **Call-to-action phrases** — "sign up", "get started", "try it now" → highlight, underline, or color pop

### How to Apply

For each detected word, specify:

- Font size multiplier (e.g., 1.3x for emphasis, 1.5x for hero moments)
- Color override (specific hex value)
- Weight/style change (bolder, italic)
- Animation variant (overshoot entrance, glow pulse, scale pop)

## Script-to-Style Mapping

Read the transcript. Detect the energy. The tone determines everything — typography, color, animation techniques. Use the table below to select your full animation stack.

| Detected energy                      | Font mood                      | Color                       | Entrance                     | Highlight                | Exit                |
| ------------------------------------ | ------------------------------ | --------------------------- | ---------------------------- | ------------------------ | ------------------- |
| High (hype, launch, music, anthem)   | Heavy condensed, 800-900       | Bright accent on dark       | Slam heroes + elastic others | Karaoke with accent glow | Scatter or drop     |
| Medium-high (social, casual, upbeat) | Rounded sans, 700-800          | Playful, colored pills      | Elastic springs + staggered  | Karaoke with color pop   | Scatter or collapse |
| Medium (corporate, pitch, explainer) | Clean sans, 600-700            | White on dark, muted accent | Clip-path reveal             | Karaoke (subtle)         | Fade + slide        |
| Medium-low (tutorial, educational)   | Mono or clean sans, 500-600    | High contrast, minimal      | Staggered entrance           | Karaoke (minimal scale)  | Fade                |
| Low (storytelling, cinematic, brand) | Serif or elegant sans, 400-500 | Warm muted tones            | 3D rotation                  | Karaoke (warm tones)     | Collapse            |

**How to detect energy from the transcript:**

- High energy: short sentences, exclamations, repetition ("up, up, up"), emotional vocabulary ("dream", "shine", "believe", "fire"), song lyrics, fast delivery (many words per second)
- Medium energy: declarative statements, product descriptions, mixed sentence length, moderate pacing
- Low energy: long flowing sentences, reflective/introspective language, slow pacing (few words per second), narrative arcs

When in doubt, **bias toward higher energy**. Boring captions are worse than slightly over-animated ones.

## Animation Design (Mandatory)

Before writing any animation code, read [dynamic-techniques.md](./dynamic-techniques.md) for the implementation patterns referenced in the table above.

**Minimum requirements — every caption composition must have:**

- At least **2 distinct highlight techniques** — cycle them across groups (e.g., odd groups get elastic pop, even groups get clip-path wipe)
- At least **1 kinetic exit** (scatter, collapse, or drop) — fade-out alone is not acceptable for medium energy or above
- **Karaoke highlight** on every composition — all words visible but muted, each lights up when spoken. This is the baseline, not optional.
- **Emphasis words get special treatment** — words flagged by per-word styling (emotional keywords, ALL CAPS, brand names) must use a different animation than surrounding words (slam, scale-pop with overshoot, or 3D flip)

**Technique cycling:** never use the same entrance on more than 3 consecutive groups. Rotate techniques using the group index to create variety. Higher energy content should cycle through more techniques.

**Energy scaling:** the detected energy level controls animation intensity:

- High: large overshoot (back.out(2.5)), fast timing (0.1-0.2s), 3+ techniques per composition, scatter/drop exits
- Medium: moderate motion (back.out(1.4)), standard timing (0.2-0.4s), 2 techniques, clip-path + fade exits
- Low: gentle reveals (power2.out), slow timing (0.4-0.6s), 1-2 techniques, collapse/fade exits

## Word Grouping by Tone

Group size affects pacing. Fast content needs fast caption turnover.

- **High energy:** 2-3 words per group. Quick turnover matches rapid delivery.
- **Conversational:** 3-5 words per group. Natural phrase length.
- **Measured/calm:** 4-6 words per group. Longer groups match slower pace.

Break groups on sentence boundaries (period, question mark, exclamation), pauses (150ms+ gap), or max word count — whichever comes first.

## Positioning

- **Landscape (1920x1080):** Bottom 80-120px, centered
- **Portrait (1080x1920):** Lower middle ~600-700px from bottom, centered
- Never cover the subject's face
- Use `position: absolute` — never relative (causes overflow)
- One caption group visible at a time

## Text Overflow Prevention

Use `window.__hyperframes.fitTextFontSize()` to measure actual rendered text width and compute the correct font size. This replaces character-count heuristics with pixel-accurate measurement powered by [pretext](https://github.com/chenglou/pretext).

```js
GROUPS.forEach(function (group, gi) {
  var result = window.__hyperframes.fitTextFontSize(group.text.toUpperCase(), {
    fontFamily: "Outfit",
    fontWeight: 900,
    maxWidth: 1600,
  });
  wordEls.forEach(function (el) {
    el.style.fontSize = result.fontSize + "px";
  });
});
```

| Option         | Default    | Description                                          |
| -------------- | ---------- | ---------------------------------------------------- |
| `maxWidth`     | `1600`     | Container width in px (1600 landscape, 900 portrait) |
| `baseFontSize` | `78`       | Starting font size — used when text fits             |
| `minFontSize`  | `42`       | Floor — never shrink below this                      |
| `fontWeight`   | `900`      | Must match the CSS font-weight                       |
| `fontFamily`   | `"Outfit"` | Must match the CSS font-family                       |
| `step`         | `2`        | Decrement step in px per iteration                   |

`fontWeight` and `fontFamily` must match the CSS applied to the text elements exactly, or measurements will be inaccurate.

**Safety nets (still required in CSS):**

- `max-width: 1600px` (landscape) or `max-width: 900px` (portrait) on caption container
- `overflow: hidden` as a fallback for `fits: false` edge cases
- `position: absolute` on all caption elements
- Explicit `height` on caption container (e.g., `200px`)

## Caption Exit Guarantee

Captions that stick on screen are the most common caption bug. Every caption group **must** have a hard kill after its exit animation.

```js
// Animate exit (soft — can fail if tweens conflict)
tl.to(groupEl, { opacity: 0, scale: 0.95, duration: 0.12, ease: "power2.in" }, group.end - 0.12);

// Hard kill at group.end (deterministic — guarantees invisible)
tl.set(groupEl, { opacity: 0, visibility: "hidden" }, group.end);
```

**Why both?** The `tl.to` exit can fail to fully hide a group when karaoke word-level tweens conflict with the parent exit tween, `fromTo` entrance tweens lock values that override later tweens, or timeline scrubbing lands between the exit start and end. The `tl.set` at `group.end` is a deterministic kill — it fires at an exact time, doesn't animate, and can't be overridden.

**Self-lint rule:** After building the timeline, verify every caption group has a hard kill:

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

Place this **before** `window.__timelines[id] = tl` so it runs at composition init.

## Constraints

- **Deterministic.** No `Math.random()`, no `Date.now()`.
- **Sync to transcript timestamps.** Words appear when spoken.
- **One group visible at a time.** No overlapping caption groups.
- **Every caption group must have a hard `tl.set` kill at `group.end`.** Exit animations alone are not sufficient.
- **Never `overflow: hidden` on caption containers or groups.** Glow, shadow, and scale effects paint outside the box — clipping them creates hard visual cutoffs. Always use `overflow: visible`.
- **Music requires audio-reactive captions.** If the source audio is music (any genre, any energy level), extract audio data with `extract-audio-data.py` and wire bass/treble reactivity into the composition. See [dynamic-techniques.md](./dynamic-techniques.md). This is not optional.
- **Check project root** for font files before defaulting to Google Fonts.
