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

### How transcripts are generated

`hyperframes transcribe` handles both transcription and format conversion:

```bash
# Transcribe audio/video (uses whisper.cpp locally, no API key needed)
npx hyperframes transcribe audio.mp3

# Use a larger model for better accuracy
npx hyperframes transcribe audio.mp3 --model medium.en

# Filter to English only (skips non-English speech)
npx hyperframes transcribe audio.mp3 --language en

# Import an existing transcript from another tool
npx hyperframes transcribe captions.srt
npx hyperframes transcribe captions.vtt
npx hyperframes transcribe openai-response.json
```

### Supported input formats

The CLI auto-detects and normalizes these formats:

| Format                | Extension | Source                                                                      | Word-level?       |
| --------------------- | --------- | --------------------------------------------------------------------------- | ----------------- |
| whisper.cpp JSON      | `.json`   | `hyperframes init --video`, `hyperframes transcribe`                        | Yes               |
| OpenAI Whisper API    | `.json`   | `openai.audio.transcriptions.create({ timestamp_granularities: ["word"] })` | Yes               |
| SRT subtitles         | `.srt`    | Video editors, subtitle tools, YouTube                                      | No (phrase-level) |
| VTT subtitles         | `.vtt`    | Web players, YouTube, transcription services                                | No (phrase-level) |
| Normalized word array | `.json`   | Pre-processed by any tool                                                   | Yes               |

**Word-level timestamps produce better captions.** SRT/VTT give phrase-level timing, which works but can't do per-word animation effects.

### Whisper model guide

The default model (`small.en`) balances accuracy and speed. For better results, use a larger model:

| Model       | Size   | Speed    | Accuracy  | When to use                           |
| ----------- | ------ | -------- | --------- | ------------------------------------- |
| `tiny.en`   | 75 MB  | Fastest  | Low       | Quick previews, testing pipeline      |
| `base.en`   | 142 MB | Fast     | Fair      | Short clips, clear audio              |
| `small.en`  | 466 MB | Moderate | Good      | **Default** — good for most content   |
| `medium.en` | 1.5 GB | Slow     | Very good | Important content, noisy audio, music |
| `large-v3`  | 3.1 GB | Slowest  | Best      | Multilingual, production captions     |

`.en` models are English-only and more accurate for English. Drop the `.en` suffix for multilingual (e.g., `medium` instead of `medium.en`).

**Music and vocals over instrumentation**: `small.en` will misidentify lyrics — use `medium.en` as the minimum, or import lyrics manually. Even `medium.en` struggles with heavily produced tracks; for music videos, providing known lyrics as an SRT/VTT and importing with `hyperframes transcribe lyrics.srt` will always beat automated transcription.

### Using external transcription APIs

For the best accuracy, use an external API and import the result:

**OpenAI Whisper API** (recommended for quality):

```bash
# Generate with word timestamps, then import
curl https://api.openai.com/v1/audio/transcriptions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -F file=@audio.mp3 -F model=whisper-1 \
  -F response_format=verbose_json \
  -F "timestamp_granularities[]=word" \
  -o transcript-openai.json

npx hyperframes transcribe transcript-openai.json
```

**Groq Whisper API** (fast, free tier available):

```bash
curl https://api.groq.com/openai/v1/audio/transcriptions \
  -H "Authorization: Bearer $GROQ_API_KEY" \
  -F file=@audio.mp3 -F model=whisper-large-v3 \
  -F response_format=verbose_json \
  -F "timestamp_granularities[]=word" \
  -o transcript-groq.json

npx hyperframes transcribe transcript-groq.json
```

### If no transcript exists

1. Check the project root for `transcript.json`, `.srt`, or `.vtt` files
2. If none found, ask the user to provide one or run:
   ```bash
   npx hyperframes transcribe <audio-or-video-file>
   ```
3. If transcription quality is poor (words at wrong times, gibberish), suggest upgrading the model:
   ```bash
   npx hyperframes transcribe audio.mp3 --model medium.en
   ```

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

| Script tone          | Font mood                             | Animation                               | Color                                        | Size                 |
| -------------------- | ------------------------------------- | --------------------------------------- | -------------------------------------------- | -------------------- |
| Hype/launch          | Heavy condensed, 800-900 weight       | Scale-pop, back.out(1.7), fast 0.1-0.2s | Bright accent on dark (cyan, yellow, lime)   | Large 72-96px        |
| Corporate/pitch      | Clean sans-serif, 600-700 weight      | Fade + slide-up, power3.out, 0.3s       | White/neutral on dark, single muted accent   | Medium 56-72px       |
| Tutorial/educational | Mono or clean sans, 500-600 weight    | Typewriter or gentle fade, 0.4-0.5s     | High contrast, minimal color                 | Medium 48-64px       |
| Storytelling/brand   | Serif or elegant sans, 400-500 weight | Slow fade, power2.out, 0.5-0.6s         | Warm muted tones, low opacity (0.85-0.9)     | Smaller 44-56px      |
| Social/casual        | Rounded sans, 700-800 weight          | Bounce, elastic.out, word-by-word       | Playful colors, colored backgrounds on pills | Medium-large 56-80px |

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

**Usage in composition scripts:**

```js
GROUPS.forEach(function (group, gi) {
  // Measure with text-transform applied (captions typically uppercase)
  var result = window.__hyperframes.fitTextFontSize(group.text.toUpperCase(), {
    fontFamily: "Outfit",
    fontWeight: 900,
    maxWidth: 1600,
  });

  // Apply computed font size to all word spans
  wordEls.forEach(function (el) {
    el.style.fontSize = result.fontSize + "px";
  });

  // If result.fits is false, text exceeds minFontSize — overflow: hidden catches it
});
```

**Options:**

| Option         | Default    | Description                                          |
| -------------- | ---------- | ---------------------------------------------------- |
| `maxWidth`     | `1600`     | Container width in px (1600 landscape, 900 portrait) |
| `baseFontSize` | `78`       | Starting font size — used when text fits             |
| `minFontSize`  | `42`       | Floor — never shrink below this                      |
| `fontWeight`   | `900`      | Must match the CSS font-weight                       |
| `fontFamily`   | `"Outfit"` | Must match the CSS font-family                       |
| `step`         | `2`        | Decrement step in px per iteration                   |

**Important:** The `fontWeight` and `fontFamily` options must match the CSS applied to the text elements exactly, or measurements will be inaccurate.

**Safety nets (still required in CSS):**

- `max-width: 1600px` (landscape) or `max-width: 900px` (portrait) on caption container
- `overflow: hidden` as a fallback for `fits: false` edge cases
- `position: absolute` on all caption elements
- Explicit `height` on caption container (e.g., `200px`)

## Caption Exit Guarantee

Captions that stick on screen are the most common caption bug. Every caption group **must** have a hard kill after its exit animation.

**The pattern:**

```js
// Animate exit (soft — can fail if tweens conflict)
tl.to(groupEl, { opacity: 0, scale: 0.95, duration: 0.12, ease: "power2.in" }, group.end - 0.12);

// Hard kill at group.end (deterministic — guarantees invisible)
tl.set(groupEl, { opacity: 0, visibility: "hidden" }, group.end);
```

**Why both?** The `tl.to` exit can fail to fully hide a group when:

- Karaoke word-level tweens (`scale`, `color`) on child elements conflict with the parent exit tween
- `fromTo` entrance tweens lock start/end values that override later tweens on the same property
- Timeline scrubbing lands between the exit start and end

The `tl.set` at `group.end` is a deterministic kill — it fires at an exact time, doesn't animate, and can't be overridden by other tweens at different times.

**Self-lint rule:** After building the timeline, verify every caption group has a hard kill. Run this check before registering the timeline:

```js
// Caption lint: verify every group has a hard kill
GROUPS.forEach(function (group, gi) {
  var el = document.getElementById("cg-" + gi);
  if (!el) return;
  tl.seek(group.end + 0.01);
  var computed = window.getComputedStyle(el);
  if (computed.opacity !== "0" && computed.visibility !== "hidden") {
    console.warn(
      "[caption-lint] group " +
        gi +
        " ('" +
        group.text +
        "') still visible at t=" +
        (group.end + 0.01).toFixed(2) +
        "s",
    );
  }
});
tl.seek(0); // reset after lint
```

Place this **before** `window.__timelines[id] = tl` so it runs at composition init. Warnings appear in the browser console during `hyperframes preview`.

## Constraints

- **Deterministic.** No `Math.random()`, no `Date.now()`.
- **Sync to transcript timestamps.** Words appear when spoken.
- **One group visible at a time.** No overlapping caption groups.
- **Every caption group must have a hard `tl.set` kill at `group.end`.** Exit animations alone are not sufficient.
- **Check project root** for font files before defaulting to Google Fonts.
