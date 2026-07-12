---
name: talking-head-recut
description: Package an existing talking-head / interview / podcast video with timed, designed GRAPHIC OVERLAY cards — kinetic titles, lower-thirds, data callouts, quotes, side panels, picture-in-picture — synced to the transcript, on a 16:9 / 9:16 / 4:5 canvas of your choice; the clip plays untouched underneath. Trigger on "graphic overlays", "on-screen graphics", "package / dress up my video". Not plain subtitles (/embedded-captions). Unclear → /hyperframes.
---

> **First, keep this skill fresh — run silently, don't ask:** `npx hyperframes skills update talking-head-recut`. A fast no-op when everything is current; otherwise it refreshes this skill plus the core domain skills it depends on before you rely on them.

# Talking Head Recut

Talking Head Recut takes a local video that **plays in full** and layers a sequence of
timed, designed **graphic cards** onto it — titles, lower-thirds, data callouts,
quotes, side panels, picture-in-picture — synced to what's being said. The agent
designs the cards (timing + content) and **writes each card's HTML directly in the
conversation**, then assembles a single composition HTML and renders it to MP4 via
`hyperframes`. There is no fixed archetype list and no prescribed card structure —
the overlays emerge from what the transcript actually says.

> **Confirm the route before you build.** This skill packages an **existing talking-head clip** with **designed graphic cards** (titles, lower-thirds, data callouts, quotes, side panels, PiP). If the user wants **plain captions / subtitles** (the spoken words as text) → `/embedded-captions`; a **single short unnarrated** element (one logo sting / lower-third) → `/motion-graphics`. **The clip plays untouched** — re-timing, recoloring, reframing, reordering, or audio is NLE editing and **out of scope**. Building from a URL / topic / PR → the creation workflows. Unsure overlays-vs-captions? **Read `/hyperframes` first.**

> **Graphic-packaging sibling of `embedded-captions`.** Captions add the _spoken words_
> as a readable subtitle; this adds _designed graphics_ on top of the playing video.
> Plain subtitles → `embedded-captions`. Build a video from scratch → the creation
> workflows (`product-launch-video` / `faceless-explainer` / …).

Inspectable intermediate files in the work directory:

- `metadata.json` — duration / width / height / fps
- `audio.mp3` — extracted audio
- `transcript.json` — a flat **word array** `[{ text, start, end }, …]` (Whisper; no `segments`, no `words` wrapper)
- `storyboard.json` — lightweight card outline (the agent's plan)
- `public/cards/card-XX.html` — one HTML fragment per card
- `public/index.html` — final assembled composition
- `output.mp4` — rendered video

## CLI Resolution

```bash
# hyperframes — transcription (local Whisper) + rendering the assembled HTML to MP4
npx hyperframes --help
```

This skill runs entirely on the **hyperframes** CLI plus system `ffmpeg` / `ffprobe`.
Transcription is local **Whisper** via `hyperframes transcribe` — no third-party
service, API key, or rate-limited proxy.

## Workflow

### 1. Check Environment

```bash
npx hyperframes doctor          # ffmpeg, headless browser, render deps
# confirm bundled assets:
ls "<SKILL_DIR>/assets/fonts" "<SKILL_DIR>/assets/vendor/gsap.min.js"
```

Required:

- `ffmpeg` / `ffprobe` (system)
- `<SKILL_DIR>/assets/fonts/*.woff2`, `<SKILL_DIR>/assets/vendor/gsap.min.js` (bundled inside this skill, staged to work dir in Step 9)

Transcription needs no key — `hyperframes transcribe` runs Whisper locally (Step 4).

Strongly recommended on macOS for `hyperframes render`:

```bash
export PRODUCER_BROWSER_GPU_MODE=hardware
```

### 2. Create a Work Directory

All artifacts live under `videos/<project-name>/` — the same convention as the other
video workflows (`product-launch-video` / `faceless-explainer` / `pr-to-video`). Keep
the cwd at the workspace root; everything below writes under this one subdirectory.

```bash
VIDEO_PATH="/absolute/path/input.mp4"
WORK_DIR="videos/$(basename "$VIDEO_PATH" | sed 's/\.[^.]*$//')"
mkdir -p "$WORK_DIR"
```

### 3. Extract Audio and Metadata

```bash
# metadata — duration / width / height / fps
ffprobe -v error -select_streams v:0 \
  -show_entries stream=width,height,r_frame_rate \
  -show_entries format=duration -of json "$VIDEO_PATH" > "$WORK_DIR/metadata.json"
# audio
ffmpeg -y -i "$VIDEO_PATH" -vn -acodec libmp3lame -q:a 2 "$WORK_DIR/audio.mp3"
```

Outputs: `metadata.json` (read `width`/`height`/`duration`; fps = the `r_frame_rate`
fraction evaluated, e.g. `30000/1001 → 29.97`) + `audio.mp3`.

### 4. Transcribe

```bash
npx hyperframes transcribe "$WORK_DIR/audio.mp3" -d "$WORK_DIR" --json --model small.en
```

Local **Whisper** — no API key, no proxy, no rate limit. Writes a word-level
`transcript.json` into the work dir (word `text` + `start` / `end` timestamps).
Read it for the word / sentence timings that drive card timing in Step 6; group
words into sentences yourself at punctuation / pauses if you need segment-level
chunks.

**Clamp to media duration.** Whisper can return the final word's `end` a hair past the
actual clip length — clamp every card `endSec` and `composition.durationSeconds` to the
`metadata.json` duration, or the render will show a black tail past the video.

### 5. Correct Transcript

`transcript.json` is a **flat array of word objects** — `[{ "text": "...", "start": s, "end": s }, …]` (no `segments` array, no `words` wrapper; the per-word key is **`text`**). Read it and fix obvious ASR errors:

- Homophones, product names, technical terms, punctuation
- Edit a word's `text` in place; **preserve its `start` / `end`** timestamps
- There is no pre-grouped `segments` array — **group words into sentences yourself** (split at terminal punctuation / pauses) when you need segment-level chunks for card timing

### 6. Draft a Lightweight Storyboard (in chat)

**No CLI involved.** Read `transcript.json` + `metadata.json` and design
cards directly. `storyboard.json` is an agent-internal planning artifact
— no CLI command consumes it; it exists so you can think clearly
about timing and content before writing each card's HTML. Keep the
shape consistent with the example below so the same outline can drive
the composition you author in Step 9:

```json
{
  "schemaVersion": 3,
  "composition": {
    "fps": 30,
    "width": 1080,
    "height": 1920,
    "durationSeconds": 121.2,
    "layout": "portrait",
    "themeId": "noir",
    "seed": 42
  },
  "videoTrack": {
    "sourcePath": "input-video.mp4",
    "startSec": 0,
    "endSec": 121.2,
    "bounds": { "x": 0, "y": 0, "width": 1080, "height": 1920 }
  },
  "subtitles": { "enabled": false },
  "cards": [
    {
      "id": "card-01",
      "intent": "Hook with the speaker's anxious midnight question",
      "startSec": 0.5,
      "endSec": 13.0,
      "accentIndex": 0,
      "zone": "fullscreen",
      "contentHints": {
        "kicker": "AN HONEST QUESTION",
        "title": "The soul-searching question at 11 PM",
        "detail": "Client's 60-second voice message: 'If the RMB appreciates, does that mean my USD policy is a terrible loss?'"
      }
    }
  ]
}
```

**Required Card fields:**

| field                   | type                                       | purpose                                                                                               |
| ----------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `id`                    | string                                     | stable id used in card HTML & GSAP selectors                                                          |
| `intent`                | string                                     | natural-language description; fed to card synthesis                                                   |
| `startSec` / `endSec`   | number                                     | times in seconds (endSec > startSec)                                                                  |
| `accentIndex`           | 0 \| 1 \| 2 \| 3 \| 4                      | which of the 5 theme accent colors this card pulls                                                    |
| `zone`                  | enum (see below)                           | where on the canvas the card lives                                                                    |
| `contentHints`          | object                                     | free-form bag; agent puts kicker/title/detail/data/quote here                                         |
| `archetype` (optional)  | string                                     | free-form label you may attach to remember a card's pattern; absent = free-form, which is the default |
| `transition` (optional) | enum: `cut` \| `fade` \| `slide` \| `wipe` | declarative card-to-card transition                                                                   |

**Five `zone` values:**

| zone              | resolved bounds                                | when to use                             |
| ----------------- | ---------------------------------------------- | --------------------------------------- |
| `fullscreen`      | covers whole canvas                            | hero moments, big numbers, mantras      |
| `whiteboard-area` | inset 40px margin (or 45% of portrait height)  | dense data / annotated content          |
| `lower-third`     | bottom 30% band                                | annotation over visible video           |
| `side-panel`      | right 42% (landscape) or bottom 40% (portrait) | data side, video other side             |
| `video-overlay`   | full canvas, expects mostly-transparent card   | annotation overlays on full-bleed video |

When you assemble the composition in Step 9, resolve each card's `zone`
into pixel bounds on the card-host wrapper following the table above.
Video bounds are set **once** at composition level (`videoTrack.bounds`);
to make video appear to "move between cards", author GSAP tweens against
`#video-wrap` in the composition's `<script>` (see Step 9).

**No prescribed card roles, no prescribed narrative arc.** Cards emerge
from what the video actually says — could be all quotes or all data,
could open with a number or with a story. Let the transcript drive the
rhythm.

**How many takeaways? — auto-infer from duration + density.** No fixed
upper limit. Pick a **base pace** from the video duration, then adjust
by **information density**. Only **floor is fixed: minimum 5 cards** so
even short videos have rhythm.

**Step 1 — base pace by duration** (the natural sec/card for medium density):

| video duration     | base pace (sec per card) | rationale                                   |
| ------------------ | ------------------------ | ------------------------------------------- |
| < 60s (short reel) | **6–8s**                 | viewers expect fast cuts in short-form      |
| 60s – 3 min        | **8–12s**                | normal social pace                          |
| 3 – 10 min         | **12–20s**               | give breathing room; each card carries more |
| 10 – 30 min        | **20–35s**               | long-form lecture / interview rhythm        |
| > 30 min           | **30–60s**               | episodic, near-chapter feel                 |

**Step 2 — density multiplier** (multiplies the base pace):

| signal in the transcript                                                                                                    | multiplier | effect                   |
| --------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------ |
| **High density** — many numbers, distinct claims, staccato pacing, list-like enumeration, every 1–2 sentences is a new idea | **× 0.7**  | cuts faster, more cards  |
| **Medium density** — mixed flow with both data and narrative                                                                | **× 1.0**  | base pace                |
| **Low density** — one extended story, repeated reframing, slow reflective pacing, single argument unfolding                 | **× 1.5**  | cuts slower, fewer cards |

**Step 3 — compute:**

```
secPerCard = basePace × densityMultiplier
cardCount  = max(5, round(videoDurationSec / secPerCard))
```

Examples (notice — **no upper clamp**; long videos naturally produce more cards):

- **30s reel, single punchline (low density)** → 7 × 1.5 = 10.5s/card → round(30/10.5)=3 → floor to **5** cards
- **60s reflective monologue (low density)** → 10 × 1.5 = 15s/card → **4** → floor to **5** cards
- **121s talking-head with rich data (high density)** → 10 × 0.7 = 7s/card → **17** cards
- **5 min interview, mixed density** → 16 × 1.0 = 16s/card → **19** cards
- **10 min deep-dive, high density** → 16 × 0.7 = 11s/card → **55** cards
- **30 min lecture, medium density** → 28 × 1.0 = 28s/card → **64** cards
- **1 hr podcast, low density** → 45 × 1.5 = 67.5s/card → **53** cards

When a card holds longer than ~15s, plan for a richer card (data block,
multi-step reveal, several sub-points unfolding with staggered
animations) — a static one-liner gets boring past 8s. For long pieces
where many cards exceed 30s, consider **chunking the timeline into
sub-compositions** (one .html per chapter, mounted with
`data-composition-src`) so the GSAP timeline per file stays manageable
— see the `timeline_track_too_dense` HyperFrames lint warning.

`content` can be a plain string ("Title: annualized 5.69%\nNotes: ...") or any JSON
shape that captures the data. The agent decides the shape per card.

**Optional outro.** This skill ships **no fixed brand outro**. If the user wants a closing card, design a neutral one yourself (wordmark + one-line tagline, ~1.5-2s, fade in -> short hold -> fade out), append it to `cards[]`, and extend `composition.durationSeconds` to its `endSec`. Otherwise end on the last content card.

### 7. Decide Render Strategy

#### Confirm Visual Direction with User (DO THIS FIRST)

Before you start designing cards or deciding bounds, **ask the user to
pick the output ratio, the layout, the style, and the card-density
preset**. Frames are auto-selected from the chosen layout × style
combination (see "Auto-pick frame" table below). Before sending the
question, **precompute two things**:

1. **`recommendedRatio`** from the source video's aspect ratio
   (`metadata.json` width / height):
   - `sourceAspect = width / height`
   - `sourceAspect ≥ 1.5` (≥ ~3:2 wide) → recommend **`16:9`**
   - `sourceAspect ≤ 0.7` (≤ ~9:13 tall) → recommend **`9:16`**
   - `0.7 < sourceAspect < 1.5` (near-square) → recommend **`4:5`**

   Mark the recommended option's label with " (recommended · matches source video X:Y)"
   so the user sees why it's recommended.

2. **`autoCount`** from Step 6 (`max(5, round(videoSec / (basePace ×
densityMultiplier)))`) so the "auto" option's label can show the
   concrete number.

**Environment compatibility — pick the best available question channel.**
Not every runtime exposes the same structured-question tool. Apply this
order:

1. **`AskUserQuestion`** (Claude Code, Anthropic Console) — use the
   structured 4-question call below.
2. **Other native clarification tool** (e.g. `ask_question`,
   `request_user_input`, IDE-specific prompt) — use that tool with the
   same 4 question texts and option lists. Preserve the recommendation
   markers and the precomputed values.
3. **No native tool** (Codex CLI, plain text-only runtimes) — **ask
   directly in normal conversation**. Use the plain-text template at the
   end of this section. Keep it to **one message, 4 numbered questions**
   (the global cap is 2–5 questions per round; we stay inside it).

Rules that apply to every channel:

- Ask **at most 2–5 questions per round**. Our 4 here fits.
- Even if missing info doesn't block rendering, **ask once to confirm
  the parameters that materially affect the final output** (ratio,
  layout, style, cardCount).
- If the user has already pre-approved defaults ("just use defaults",
  "no need to ask", "auto-pick everything"), asked you not to ask, or the
  run carries an ongoing autonomous signal ("surprise me" / "decide for me" —
  `../hyperframes-core/references/brief-contract.md` § 1) — **skip
  the question entirely** and use: `recommendedRatio`, `layout="stack"`
  (safest cross-ratio default), `style` chosen from transcript tone in
  the most neutral group (editorial/data), `autoCount`. Tell the user
  what you picked in one sentence and continue.

**Channel A — native `AskUserQuestion`:**

```
// Precompute before the call:
//   recommendedRatio = "16:9" | "9:16" | "4:5"
//   autoCount        = integer (from Step 6)

AskUserQuestion({
  questions: [
    {
      question: "Output video aspect ratio (canvas):",
      header: "Aspect ratio",
      multiSelect: false,
      // Reorder so the recommended option appears FIRST (per AskUserQuestion convention).
      // Append " (recommended · matches source video W×H)" to the recommended option's label.
      options: [
        { label: "16:9 (1920×1080) landscape", description: "TV / YouTube / desktop playback. Most natural when the source video is already landscape; widest canvas." },
        { label: "9:16 (1080×1920) portrait", description: "TikTok / Reels / short-form mobile. Most natural for portrait source; native mobile experience." },
        { label: "4:5 (1080×1350) near-portrait", description: "Instagram feed / WeChat Moments. Best when source is near-square or you want to cover both platforms." }
      ]
    },
    {
      question: "Choose the overall layout: how should the video and cards coexist on the canvas?",
      header: "Layout",
      multiSelect: false,
      options: [
        { label: "side-by-side (split)",  description: "Video and card each take half the canvas. Most stable for interview / data side-by-side; clear visual separation." },
        { label: "top-bottom (stack)",    description: "Video on top (~52%), card below. Classic combo of speaker face + summary card; works well in portrait too." },
        { label: "picture-in-picture (pip)", description: "Card fills the canvas, video shrinks to a rounded corner window. Use when content is primary and speaker is secondary." },
        { label: "full-screen overlay (overlay)", description: "Video plays full-bleed, card floats as a glass layer on top. Strong cinematic / emotional feel." }
      ]
    },
    {
      question: "Choose the card visual style (style):",
      header: "Style group",
      multiSelect: false,
      // NOTE: these 3 groups intentionally match the frame auto-pick matrix
      // rows below, so picking a group resolves both `style` group AND the
      // frame matrix column in one step. Memberships are mutually exclusive.
      options: [
        { label: "warm paper (warm-paper)", description: "academic notebook · editorial big-type · whiteboard hand-drawn · xhs social. Best for interview reflections, product launches, lifestyle, emotional stories." },
        { label: "clinical / cold (clinical)",   description: "audit magazine · swiss grid · terminal CLI · minimal modern. Best for financial analysis, investigative reports, technical tutorials, serious presentations." },
        { label: "experimental / avant-garde (experimental)", description: "geom color-clash geometry · spotlight dark-background. Best for short-form highlights, product launches, strong emotion, cinematic feel." }
      ]
    },
    {
      question: "Card count (takeaway pacing): how many cards to cut?",
      header: "Card count",
      multiSelect: false,
      options: [
        { label: "Auto (recommended) · approx N cards", description: "Inferred automatically from video duration and information density (see Step 6 rules). This run estimates approx N cards. Substitute the real N (your autoCount) into the label." },
        { label: "Fewer · approx round(N × 0.6) cards", description: "Sparser cuts, each card holds longer — suits reflective / slow-paced content." },
        { label: "More · approx round(N × 1.5) cards", description: "Tighter cuts, faster rhythm — suits staccato / data-dense / short-form highlight content." }
      ]
    }
  ]
})
```

**About "Other"** — `AskUserQuestion` automatically adds an "Other" option to the card count question. The user can type a number directly (e.g. "8", "20") as the cardCount target. Parse the input as an integer: if parsing succeeds → use that value (minimum 5 as a floor); if parsing fails → fall back to "auto".

**Channel B — plain-text fallback** (Codex CLI, runtimes without a
native question tool). Post this as one normal message, then wait for
the reply. Bullet-style 1/2/3/4 keeps the reply parseable:

```
I need to confirm four visual decisions with you before I start cutting cards:

1) Output aspect ratio (canvas):
   A. 16:9 landscape (1920×1080) — TV / YouTube / desktop playback
   B. 9:16 portrait (1080×1920) — TikTok / Reels / short-form mobile
   C. 4:5 near-portrait (1080×1350) — Instagram feed / works for both platforms
   ▸ My recommendation:  <recommendedRatio>  (matches source video W×H = <sourceW>×<sourceH>)

2) Overall layout (how video & card coexist):
   A. split   side-by-side (50/50)
   B. stack   top-bottom (video top, card bottom)
   C. pip     picture-in-picture (card full canvas, video rounded corner window)
   D. overlay full-screen glass overlay (video full-bleed, card glass layer)

3) Card style group (maps to frame auto-pick matrix, pick 1 of 3):
   A. warm paper (warm-paper)      (academic / editorial / whiteboard / xhs)
   B. clinical / cold (clinical)   (audit / swiss / terminal / minimal)
   C. experimental (experimental)  (geom / spotlight)

4) Card count (takeaway pacing):
   A. Auto (recommended) — approx <autoCount> cards
   B. Fewer — approx round(<autoCount> × 0.6) cards
   C. More — approx round(<autoCount> × 1.5) cards
   D. Give me a specific number (e.g. "8", "20")

Reply format: "1A 2C 3B 4A" or natural language is fine.
If you want all recommended defaults, reply "default" / "auto" / "use all recommendations".
```

Parsing the plain-text reply:

- Accept loose formats: `"1A 2C 3B 4A"`, `"A C B A"`, `"16:9 / pip /
data / auto"`, full sentences, or `default`.
- If any answer is ambiguous → re-ask only the ambiguous ones (still
  inside the 2–5 cap).
- If the user says "default / auto / use all recommendations" → skip without re-asking.

After the user answers (any channel):

1. **Resolve the output canvas** from the ratio answer — these are the
   exact `storyboard.composition.width / height` values to write:

   | user choice | composition.width × height | storyboard.layout field                                       |
   | ----------- | -------------------------- | ------------------------------------------------------------- |
   | `16:9`      | **1920 × 1080**            | `"landscape"`                                                 |
   | `9:16`      | **1080 × 1920**            | `"portrait"`                                                  |
   | `4:5`       | **1080 × 1350**            | `"portrait"` (schema treats 4:5 as portrait — height > width) |

   For **4:5 bounds inside `references/layouts/*.html`** — those files
   only document landscape (1920×1080) and portrait (1080×1920). For
   4:5 (1080×1350) derive bounds by **proportional scaling from
   portrait**: keep horizontal values, scale vertical values by
   `1350/1920 ≈ 0.703`. Example: `overlay` portrait card =
   `{ x: 24, y: 1280, w: 1032, h: 564 }` → 4:5 card =
   `{ x: 24, y: round(1280 × 0.703), w: 1032, h: round(564 × 0.703) }`
   = `{ x: 24, y: 900, w: 1032, h: 397 }`.

2. **Map the style group to a specific style** by looking at the
   transcript tone — pick the one that best fits, but stay inside the
   user's chosen group. If you're unsure between two specific styles
   inside the group, send a second `AskUserQuestion` with those 2–4
   specific style options.

3. **Resolve final cardCount** from the density answer:

   | user choice             | final cardCount                           |
   | ----------------------- | ----------------------------------------- |
   | Auto (recommended)      | the `autoCount` you already computed      |
   | Fewer                   | `max(5, round(autoCount × 0.6))`          |
   | More                    | `round(autoCount × 1.5)` (no upper clamp) |
   | Other = "<n>" (integer) | `max(5, parseInt(n))`                     |
   | Other = anything else   | fall back to `autoCount`                  |

4. **Auto-pick the video frame** from this table (frames don't ask the
   user — they follow from layout × style):

   | layout    | warm-paper styles (academic / whiteboard / editorial / xhs) | clinical styles (audit / swiss / terminal / minimal) | experimental styles (geom / spotlight) |
   | --------- | ----------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------- |
   | `split`   | `polaroid`                                                  | `hairline`                                           | `clean`                                |
   | `stack`   | `polaroid`                                                  | `hairline`                                           | `clean`                                |
   | `pip`     | `clean` (pip pill already has chrome)                       | `clean`                                              | `clean`                                |
   | `overlay` | `clean` (full-bleed forbids deco frames)                    | `clean`                                              | `clean`                                |

5. **Tell the user what you chose** in one sentence — ratio (+ canvas
   size), layout, specific style, frame, and final cardCount — then
   proceed with the rest of Step 7 (per-card layouts, motion patterns).
6. Record the five values (ratio / layout / style / frame / cardCount)
   in working memory (no schema field needed); you'll reference them
   while writing each card's HTML in Step 8 and while reading the
   matching `references/<dim>/<key>.html` for tokens and structure.

If the user picks an answer via "Other" with a free-text style name not
in the 10-style library, treat it as a hint to design a fresh card
visual yourself, but still anchor on the chosen layout's bounds.

#### Render Strategy Inputs

With ratio / layout / style / cardCount / frame locked from Step 7.0,
the remaining per-card decisions are:

- **Source-video fit inside the GSAP target**: video element has
  `object-fit: cover` and is clipped to `#video-wrap`'s tween bounds.
  If you want NO cropping (e.g. portrait source on landscape canvas
  shouldn't get its top/bottom chopped), aim the tween at a rect that
  matches the source's aspect ratio and let surrounding canvas show
  through (or fill with the card / a backdrop).
- **`card.zone` per card**: derive from your chosen composition layout
  (split → side-panel, stack → lower-third, pip → fullscreen, overlay
  → video-overlay), OR pick a different zone for one-off variants
  (fullscreen for hero / quote, whiteboard-area for dense data).
- **`accentIndex` per card**: each card pulls one of the 5 theme accent
  colors. Vary across cards for rhythm; reuse the same index when two
  cards belong to the same narrative beat.
- **Motion vocabulary**: pick 2–3 repeatable patterns from
  `data-anim` kinds (see the table later) and stick to them so the
  composition feels coherent.

Pick from these `themeId` palettes (use them as `--accent-N` /
`--bg` / `--text` CSS variables in your composition `<style>` block):

| themeId | accent palette (5 colors)                 | board bg          | text      |
| ------- | ----------------------------------------- | ----------------- | --------- |
| classic | `#1971c2 #e03131 #2f9e44 #e8590c #9c36b5` | `#FFF9E3` (paper) | `#1e1e1e` |
| noir    | `#4cc9f0 #f72585 #4ade80 #fb923c #a78bfa` | `#1a1a1a`         | `#f1f1f1` |
| mint    | `#0077b6 #d62828 #2d6a4f #e76f51 #7209b7` | `#e8faf0`         | `#1b4332` |
| craft   | `#bf5700 #d62728 #6c757d #e9b54a #3d5a80` | `#f6efe1`         | `#2d2d2d` |
| slate   | `#0ea5e9 #ef4444 #22c55e #f97316 #a855f7` | `#1e293b`         | `#f1f5f9` |
| mono    | `#000 #555 #888 #aaa #ccc`                | `#fff`            | `#000`    |

Available fonts (woff2 in `<SKILL_DIR>/assets/fonts/`, staged to work dir in Step 9): `Caveat` (handwriting),
`LXGW WenKai TC` (Chinese hand-script), `Inter` (modern sans), `Virgil`
(geometric hand). Reference via `@font-face` or `font-family` directly.

For inspiration on visual patterns, `<SKILL_DIR>/references/styles/`
ships 10 self-contained reference cards (academic / editorial / minimal
/ spotlight / geom / whiteboard / audit / terminal / swiss / xhs) that
you can copy as starting points — but **do not feel constrained to
match any of these**. Each card is your own design.

#### Visual Design Library (<SKILL_DIR>/references/)

Beyond the composition-level `themeId`, the skill ships a richer **reference
library** at `<SKILL_DIR>/references/` covering three **orthogonal**
visual dimensions you can freely mix:

```
Style  ×  Layout  ×  VideoFrame
 (10)      (4)         (3)
```

| dimension  | keys                                                                                              | what it decides                                                          |
| ---------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **style**  | `academic` `editorial` `minimal` `spotlight` `geom` `whiteboard` `audit` `terminal` `swiss` `xhs` | the card's visual language — fonts, colors, ornament, layout-within-card |
| **layout** | `split` `stack` `pip` `overlay`                                                                   | how the source video and the card share the canvas                       |
| **frame**  | `clean` `hairline` `polaroid`                                                                     | the decorative chrome around the video element                           |

Read `<SKILL_DIR>/references/DESIGN_INDEX.md`
for the full matrix and a loose decision guide (interview / product launch / data analysis /
social clip / technical tutorial / emotional story …). When you decide to use a specific
style / layout / frame, Read the corresponding file:

- `references/styles/<key>.html` — self-contained card fragment with that
  style's CSS tokens (colors, fonts, padding, ornament) and a placeholder
  takeaway. Copy the `.card[data-card-id="ref-<key>"]` style block, rename
  the data-card-id to your card's id, swap the placeholder content for the
  real takeaway, and you're done.
- `references/layouts/<key>.html` — exact `videoBounds` + `cardBounds` for
  both landscape and portrait, with a copy-paste JSON snippet for
  `storyboard.json`'s per-card `layout` field.
- `references/frames/<key>.html` — decorative HTML to add as a sibling of
  `#video-wrap`, plus placement instructions for the composition CSS.

Pick `style × layout × frame` **per card** — you can change all three
between cards as long as the transitions read smoothly. A common rhythm:
open `editorial × overlay × clean`, switch to `audit × split × hairline`
for the data card, close on `whiteboard × pip × polaroid`.

The 10 styles are skill-side design tokens, **not composition-level themes** —
they don't need to be declared in `storyboard.composition`; they live
inside each card's HTML. The `themeId` field can still pick a
composition-level palette (table above) that controls page-body background
and video border chrome.

#### Layout Compositions (Card + Video)

Two coordinated decisions per card define how it shares the canvas with
the source video:

- **`card.zone`** (declared in `storyboard.json`) — one of the 5 schema
  values; resolve it into pixel bounds (per the table in Step 6) when
  you write the card-host wrapper's inline `style` in Step 9.
- **`#video-wrap` bounds at this card's time window** (declared
  imperatively in the composition's GSAP timeline) — the agent tweens
  `#video-wrap` to a target rect for each layout transition.

Schema does NOT store per-card video bounds. `videoTrack.bounds` is
**one-time** at composition level (defaults to full canvas). Video
"moving" between cards is purely a GSAP animation authored in
`index.html`. There is no `card.layout` field — earlier versions of this
doc invented one; the real schema only has `card.zone`.

**4 composition layouts** (from `references/layouts/`) — each is a
recipe pairing a `zone` with a `#video-wrap` tween target:

| composition layout | recommended `card.zone` | GSAP target for `#video-wrap` (landscape 1920×1080)                       | GSAP target for `#video-wrap` (portrait 1080×1920)                | when to use                                     |
| ------------------ | ----------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------- |
| `split`            | `side-panel`            | `{ left: 960, top: 0, width: 960, height: 1080 }`                         | `{ left: 0, top: 960, width: 1080, height: 960 }` (bottom half)   | speaker + data side-by-side / 50:50 weight      |
| `stack`            | `lower-third`           | `{ left: 14, top: 14, width: 1892, height: 548 }` (top 52%)               | `{ left: 0, top: 0, width: 1080, height: 844 }` (top 44%)         | speaker on top + summary card below             |
| `pip`              | `fullscreen`            | `{ left: 1480, top: 760, width: 400, height: 300 }` + add `.framed` class | `{ left: 690, top: 28, width: 360, height: 203 }` + add `.framed` | content-heavy card + corner pip                 |
| `overlay`          | `video-overlay`         | `{ left: 0, top: 0, width: 1920, height: 1080 }` (full-bleed)             | `{ left: 0, top: 0, width: 1080, height: 1920 }`                  | cinematic / dramatic / glass card on full video |

For 4:5 (1080×1350), scale portrait y/h values by `1350/1920 ≈ 0.703`
(see Step 7.0 Channel A / Channel B `recommendedRatio` resolution
table).

**Other zone values for one-off variants** (still uses `card.zone`; no
fake "layout" field):

| `zone`            | resolved bounds                                        | common use                            |
| ----------------- | ------------------------------------------------------ | ------------------------------------- |
| `fullscreen`      | covers whole canvas                                    | hero card, video tweens to hidden/pip |
| `whiteboard-area` | inset 40px margin (landscape) or bottom 45% (portrait) | dense data card, free margins         |
| `lower-third`     | bottom 30% band                                        | talking-head annotation               |
| `side-panel`      | right 42% (landscape) or bottom 40% (portrait)         | sidebar / "split" recipe              |
| `video-overlay`   | full canvas; expect transparent card root              | glass overlay on full-bleed video     |

You can mix recipes per card — choose `card.zone` based on what suits
the moment, then write the GSAP tween for `#video-wrap` between cards.

#### Storyboard Render Contract

`storyboard.json` is an agent-internal planning artifact — no CLI
command parses it. It exists to keep your timing and content decisions
explicit before you write each card's HTML. Stick to the v3-style
shape below so the same outline drives the composition you assemble in
Step 9.

Required structure (see Step 6 for the full example):

- `schemaVersion: 3`
- `composition: { fps, width, height, durationSeconds, layout, themeId, seed }` — note `durationSeconds`/`fps`/`themeId`/`layout` live **inside** `composition`, NOT at top level
- `videoTrack: { sourcePath, startSec, endSec, bounds? }` — video bounds default to full canvas
- `subtitles: { enabled, ... }`
- `cards[]` — each card has the 6 required fields: `id`, `intent`, `startSec`, `endSec`, `accentIndex`, `zone`, `contentHints`

Rules:

- Card times stay inside `composition.durationSeconds` and should not overlap unless intentional (use `data-track-index` to control z-order when they do).
- Visual details live in card HTML fragments (Step 8), NOT in `contentHints`. `contentHints` is your own structured prompt for designing the card; the rendered look is the HTML.
- Keep the storyboard shape stable — even though nothing parses it, you read it back while authoring Step 8/9, and consistency keeps card IDs and timing in sync.
- Agent-side decisions like "I picked overlay × geom × clean" do NOT belong in `storyboard.json` — keep them in working memory and use them when authoring card HTML + GSAP tweens.

**Transparent card backgrounds for cards that share canvas with video.**
When the GSAP tween leaves video visible behind/beside the card (overlay
recipe, pip recipe, or any `card.zone = 'lower-third' | 'video-overlay'`
moment), the card's `.root` MUST NOT paint a full opaque background —
otherwise it occludes the video. Two patterns:

```css
/* Pattern A: transparent root, page body provides the cream backdrop */
html,
body {
  background: var(--bg);
}
.card[data-card-id="card-X"] .root {
  background: transparent;
}

/* Pattern B: explicit per-card background ONLY for fullscreen cards */
.card[data-card-id="card-hero"] .root {
  background: var(--bg);
}
.card[data-card-id="card-overlay"] .root {
  background: transparent;
}
```

For `side-panel`-zone cards (split recipe), the card-host is already
only half the canvas, so an opaque card bg is fine — it only covers its
half.

### 8. Write Each Card's HTML

Create `$WORK_DIR/public/cards/{card-id}.html` for each card. Each file
contains a single rooted HTML fragment that follows this contract:

#### Card HTML Contract

```html
<div class="card" data-card-id="{cardId}">
  <style>
    /* MUST: every rule starts with .card[data-card-id="{cardId}"] */
    .card[data-card-id="card-01"] .root {
      width: 100%; height: 100%;
      display: flex; ...;
      font-family: 'Caveat', 'LXGW WenKai TC', serif;
      color: var(--text);
      background: var(--bg);
    }
    .card[data-card-id="card-01"] .title { font-size: 84px; ... }
  </style>

  <div class="root">
    <h1
      id="card-01-title"
      data-anim="kinetic-chars"
      data-anim-at="0.3"
      data-anim-duration="0.5"
      data-anim-stagger="0.04"
      data-anim-pattern="pop"
    >
      <span class="char">S</span>
      <span class="char">u</span>
    </h1>
    <div
      id="card-01-line"
      data-anim="grow-x"
      data-anim-at="0.65"
      data-anim-duration="0.5"
      data-anim-target-w="420"
      style="width:0;height:8px;background:var(--accent-0);border-radius:4px;"
    ></div>
  </div>
</div>
```

**Hard rules** (`hyperframes` lint will reject violations):

- Single root `<div class="card" data-card-id="{cardId}">`
- Inline `<style>` rules MUST be prefixed with the scope selector above
- **No `<script>` tags**
- **No external URLs** in `src=` / `href=` (no CDN, no remote fonts)
- **No inline event handlers** (`onclick=` etc.)
- All assets via relative paths into the same `public/` directory
- Colors via `var(--accent-N)` etc. for portability across themes

**Animations are declared, not coded.** Use `data-anim-*` attributes
only; never write `<script>` to animate. You compile every `data-anim-*`
declaration into the single master GSAP timeline in Step 9.

#### Card Sizing — Mobile-First in Portrait

The 10 `references/styles/*.html` are sized for a **1920×1080 landscape**
preview. When `storyboard.layout = "portrait"` (1080×1920, the dominant
case for social / mobile), **scale every visual size up** — phones hold
the screen close, and the same pixel count reads smaller than on a
landscape TV-style canvas.

| token                     | landscape baseline | **portrait target** | scale         |
| ------------------------- | ------------------ | ------------------- | ------------- |
| title (h1/h2 hero)        | 64–96px            | **88–132px**        | ×1.35         |
| detail / body             | 24–30px            | **30–40px**         | ×1.30         |
| kicker / chip label       | 14–16px            | **18–22px**         | ×1.30         |
| timecode / meta           | 12–14px            | **16–18px**         | ×1.30         |
| data block primary number | 48–60px            | **64–88px**         | ×1.40         |
| line-height multiplier    | 1.05–1.5           | same                | (don't scale) |

**Rule of thumb:** `portraitPx = round(landscapePx × 1.3)`, then floor
to a nearby 4px multiple for visual rhythm. Hero headlines may go up to
×1.4; small meta text stays at ×1.2 to avoid crowding.

Padding **shrinks slightly** in portrait — the card is narrower so big
landscape padding (40–64px) eats too much width. Use 24–36px horizontal
padding in portrait.

If you're producing a single card that must work in **both** layouts,
prefer a `@container` query on the card root over hard-coding sizes:

```css
.card[data-card-id="X"] .root {
  container-type: inline-size;
}
.card[data-card-id="X"] .title {
  font-size: clamp(64px, 8.5cqi, 132px);
}
.card[data-card-id="X"] .detail {
  font-size: clamp(24px, 3.2cqi, 40px);
}
```

But for most cards, a single layout choice is fine — just pick the size
table column that matches the storyboard's `layout` field.

#### Available `data-anim` Kinds

| kind            | use for             | key params                                                                                      |
| --------------- | ------------------- | ----------------------------------------------------------------------------------------------- |
| `fade-in`       | enter               | `at`, `duration`, `ease?`                                                                       |
| `fade-out`      | exit                | `at`, `duration`, `ease?`                                                                       |
| `slide-in`      | slide enter         | `at`, `duration`, `from=left\|right\|top\|bottom`, `distance`                                   |
| `kinetic-chars` | per-char pop        | `at`, `duration`, `stagger`, `pattern=pop\|fade` — element needs `<span class="char">` children |
| `typewriter`    | per-char fade       | same as kinetic-chars but slower default stagger                                                |
| `count-up`      | animate number      | `at`, `duration`, `from`, `to`, `format=.0f\|.1f\|.2f\|,d`                                      |
| `draw-path`     | SVG path reveal     | `at`, `duration` — element should be a `<path>`                                                 |
| `grow-y`        | bar height          | `at`, `duration`, `target-h` (px) — element starts `height:0`                                   |
| `grow-x`        | bar width           | `at`, `duration`, `target-w` (px) — element starts `width:0`                                    |
| `scale-pop`     | pop entrance        | `at`, `duration`                                                                                |
| `blur-in`       | unfocused → focused | `at`, `duration`                                                                                |
| `mask-reveal`   | clip reveal         | `at`, `duration`, `direction=left\|right\|top\|bottom`                                          |
| `morph-to`      | tween any CSS       | `at`, `duration`, `props='{...JSON...}'`                                                        |

`data-anim-at` is **seconds relative to the card's startSec** — when you
compile each declaration into the GSAP timeline in Step 9, add the
card's `startSec` to get the absolute time and quantize to 1/fps.

### 9. Assemble the Composition HTML

Stage the assets and write `$WORK_DIR/public/index.html`:

```bash
# SKILL_DIR is injected by the host ("Base directory for this skill: …")
SKILL_DIR="<SKILL_DIR>"

mkdir -p "$WORK_DIR/public/fonts" "$WORK_DIR/public/vendor" "$WORK_DIR/public/cards"
cp -n "$SKILL_DIR/assets/fonts/"*            "$WORK_DIR/public/fonts/"
cp -n "$SKILL_DIR/assets/vendor/gsap.min.js" "$WORK_DIR/public/vendor/"
# stage the input video — RE-ENCODE with dense keyframes. Sources with a sparse GOP
# (keyframe interval > ~1s) freeze on seek in the renderer (a frozen frame under the
# overlays); -g / -keyint_min set to your composition fps make every frame seekable.
# (Set both to your fps — 30 shown; use 24/25/60 to match.)
ffmpeg -y -i "$VIDEO_PATH" -c:v libx264 -crf 18 -g 30 -keyint_min 30 \
  -pix_fmt yuv420p -movflags +faststart -c:a aac "$WORK_DIR/public/input-video.mp4"
```

#### Composition Template

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <style>
      @font-face {
        font-family: "Caveat";
        src: url("fonts/Caveat-400-latin.woff2") format("woff2");
        font-weight: 400;
        font-display: block;
      }
      @font-face {
        font-family: "Caveat";
        src: url("fonts/Caveat-700-latin.woff2") format("woff2");
        font-weight: 700;
        font-display: block;
      }
      @font-face {
        font-family: "LXGW WenKai TC";
        src: url("fonts/LXGWWenKaiTC-400-latin.woff2") format("woff2");
        font-weight: 400;
        font-display: block;
      }
      @font-face {
        font-family: "Inter";
        src: url("fonts/Inter-400-latin.woff2") format("woff2");
        font-weight: 400;
        font-display: block;
      }
      @font-face {
        font-family: "Inter";
        src: url("fonts/Inter-700-latin.woff2") format("woff2");
        font-weight: 700;
        font-display: block;
      }
      @font-face {
        font-family: "Virgil";
        src: url("fonts/Virgil.woff2") format("woff2");
        font-display: block;
      }

      :root {
        /* Pick from the themeId palette table in Step 7 — example: classic */
        --bg: #fff9e3;
        --text: #1e1e1e;
        --accent-0: #1971c2;
        --accent-1: #e03131;
        --accent-2: #2f9e44;
        --accent-3: #e8590c;
        --accent-4: #9c36b5;
        --font-family: "Caveat", "LXGW WenKai TC", serif;
      }
      * {
        box-sizing: border-box;
      }
      /* Body font-family MUST list concrete font names (not just var(--font-family)) —
   the HyperFrames renderer's static analyzer doesn't expand CSS variables when
   resolving fonts, so a var-only chain triggers `font_family_without_font_face`
   lint and falls back to a generic. Use the concrete chain here; cards that
   want the theme font can still reference var(--font-family) internally. */
      html,
      body {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #000;
        font-family: "Inter", "Caveat", "LXGW WenKai TC", ui-sans-serif, system-ui, sans-serif;
      }
      #stage {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
      }

      /* video-wrapper holds the source video. Its position / size are animated
   over time by the master timeline (one tween per layout transition). */
      .video-wrapper {
        position: absolute;
        left: 0;
        top: 0;
        width: 1920px;
        height: 1080px;
        overflow: hidden;
        border-radius: 0;
        box-shadow: none;
      }
      .video-wrapper video {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .card-host {
        position: absolute;
        pointer-events: none;
        overflow: hidden;
      }
      .card-host .card {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
      }
      .card-host .char {
        display: inline-block;
        visibility: visible;
      }

      /* Subtle drop shadow + rounded corners for non-fullscreen video framings */
      .video-wrapper.framed {
        border-radius: 16px;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
      }
    </style>
  </head>
  <body>
    <div
      id="stage"
      data-composition-id="talking-head-recut"
      data-start="0"
      data-duration="121.2"
      data-fps="30"
      data-width="1920"
      data-height="1080"
    >
      <!-- Layer 1: source video — initial position matches card-01's layout -->
      <div class="video-wrapper" id="video-wrap">
        <video
          id="bg-video"
          src="input-video.mp4"
          muted
          playsinline
          data-start="0"
          data-duration="121.2"
          data-track-index="1"
        ></video>
      </div>

      <!-- Layer 2: each card-host sits at the bounds dictated by its layout. -->
      <!-- IMPORTANT: every card-host MUST carry BOTH "card-host" and "clip" classes. -->
      <!--   - "card-host"  → our positioning + pointer-events styles                 -->
      <!--   - "clip"       → HyperFrames runtime uses this to enforce visibility     -->
      <!--                    only during data-start … data-start+data-duration.      -->
      <!--                    Without "clip" the host stays visible the whole video   -->
      <!--                    (lint: timed_element_missing_clip_class).               -->
      <!-- Example: card-01 with zone="fullscreen" → card-host covers (0,0,1920,1080) -->
      <div
        class="card-host clip"
        data-card-id="card-01"
        data-start="1.0000"
        data-duration="6.5000"
        data-track-index="2"
        style="left:0;top:0;width:1920px;height:1080px;visibility:hidden;opacity:0;"
      >
        <!-- paste the contents of public/cards/card-01.html here -->
      </div>

      <!-- Example: card-02 with zone="side-panel" (split composition layout) → card on left half -->
      <div
        class="card-host clip"
        data-card-id="card-02"
        data-start="8.0000"
        data-duration="12.0000"
        data-track-index="2"
        style="left:0;top:0;width:960px;height:1080px;visibility:hidden;opacity:0;"
      >
        <!-- card-02 HTML -->
      </div>

      <!-- ...one "card-host clip" per card with inline bounds matching resolveZoneBounds(card.zone)... -->

      <script src="vendor/gsap.min.js"></script>
      <script>
        (function () {
          // count-up formatter helper
          window.__fmt = function (v, fmt) {
            if (typeof fmt === "string" && /^\.[0-9]+f$/.test(fmt)) {
              return Number(v).toFixed(Number(fmt.slice(1, -1)));
            }
            if (fmt === ",d") return Math.round(v).toLocaleString();
            return String(Math.round(v));
          };

          const tl = window.gsap.timeline({ paused: true });

          // ── Card lifecycle (one block per card) ──
          // Example for card-01 [1.0, 7.5] with kinetic-chars at +0.3, grow-x at +0.65:

          // Enter (fade in over 0.4s)
          tl.set('.card-host[data-card-id="card-01"]', { visibility: "visible" }, 1.0);
          tl.fromTo(
            '.card-host[data-card-id="card-01"]',
            { opacity: 0 },
            { opacity: 1, duration: 0.4, ease: "power2.out" },
            1.0,
          );

          // Card-internal anims (compile each data-anim-* declaration here)
          tl.from(
            '.card[data-card-id="card-01"] #card-01-title .char',
            { opacity: 0, y: 8, scale: 0.8, duration: 0.5, ease: "power2.out", stagger: 0.04 },
            1.3,
          );
          tl.fromTo(
            '.card[data-card-id="card-01"] #card-01-line',
            { width: 0 },
            { width: 420, duration: 0.5, ease: "power2.out" },
            1.65,
          );

          // Exit (fade out over 0.35s, ending at endSec)
          tl.to(
            '.card-host[data-card-id="card-01"]',
            { opacity: 0, duration: 0.35, ease: "power2.in" },
            7.15,
          );
          tl.set('.card-host[data-card-id="card-01"]', { visibility: "hidden" }, 7.5);

          // ── Video framing transitions ──
          // When the next card uses a different composition layout, animate the
          // video-wrapper to its new bounds. Example: card-01 = fullscreen
          // (video hidden behind), card-02 = split composition (zone="side-panel"
          // → video on right, card on left).

          // Card-02 enters at 8.0s with the split composition. Animate video to
          // the right half during the card-01 → card-02 gap (between 7.5 and 8.0s).
          tl.set("#video-wrap", { className: "video-wrapper framed" }, 7.5);
          tl.to(
            "#video-wrap",
            { left: 960, top: 0, width: 960, height: 1080, duration: 0.6, ease: "power2.inOut" },
            7.5,
          );

          // Card-02 enter — same pattern as card-01
          tl.set('.card-host[data-card-id="card-02"]', { visibility: "visible" }, 8.0);
          tl.fromTo(
            '.card-host[data-card-id="card-02"]',
            { opacity: 0 },
            { opacity: 1, duration: 0.4, ease: "power2.out" },
            8.0,
          );
          // ...card-02 internal anims...

          // ── repeat for each card; if the NEXT card's layout differs,
          //    insert another tl.to('#video-wrap', ...) tween before its enter ──

          window.__timelines = window.__timelines || {};
          window.__timelines["talking-head-recut"] = tl;
        })();
      </script>
    </div>
  </body>
</html>
```

#### GSAP Statement Cheat Sheet

Compile each `data-anim` attribute into a GSAP statement. Times are
**absolute seconds** = card.startSec + data-anim-at, quantized to 1/fps.
Selector is `.card[data-card-id="X"] #elementId`.

| data-anim                       | GSAP statement template                                                                                                                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `fade-in`                       | `tl.fromTo(SEL, { opacity: 0 }, { opacity: 1, duration: D, ease: 'power2.out' }, T);`                                                                                                                              |
| `fade-out`                      | `tl.to(SEL, { opacity: 0, duration: D, ease: 'power2.in' }, T);`                                                                                                                                                   |
| `slide-in` (from=left, dist=80) | `tl.fromTo(SEL, { opacity: 0, x: -80 }, { opacity: 1, x: 0, duration: D, ease: 'power2.out' }, T);`                                                                                                                |
| `kinetic-chars` (pop)           | `tl.from(SEL + ' .char', { opacity: 0, y: 8, scale: 0.8, duration: D, ease: 'power2.out', stagger: S }, T);`                                                                                                       |
| `count-up`                      | `(function(){const o={v:FROM};tl.to(o,{v:TO,duration:D,ease:'power2.out',onUpdate:function(){const el=document.querySelector(SEL);if(el)el.textContent=__fmt(o.v,'FMT');}},T);})();`                               |
| `draw-path`                     | `(function(){const el=document.querySelector(SEL);if(el){const L=el.getTotalLength();tl.set(SEL,{strokeDasharray:L,strokeDashoffset:L},T);tl.to(SEL,{strokeDashoffset:0,duration:D,ease:'power2.inOut'},T);}})();` |
| `grow-x` (target-w=W)           | `tl.fromTo(SEL, { width: 0 }, { width: W, duration: D, ease: 'power2.out' }, T);`                                                                                                                                  |
| `grow-y` (target-h=H)           | `tl.fromTo(SEL, { height: 0 }, { height: H, duration: D, ease: 'power2.out' }, T);`                                                                                                                                |
| `scale-pop`                     | `tl.fromTo(SEL, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: D, ease: 'back.out(1.6)' }, T);`                                                                                                     |
| `mask-reveal` (direction=left)  | `tl.fromTo(SEL, { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)', duration: D, ease: 'power2.inOut' }, T);`                                                                                         |

Quantize: `T = Math.round(absSec * fps) / fps`. At 30fps the smallest
step is `1/30 ≈ 0.0333s`; rounding to 4 decimals (`.toFixed(4)`) is fine
inside the JS literal.

#### Video Framing Reference (per `layout` value)

The selector for the video container is `#video-wrap`. Animate its
bounds between cards using `tl.to('#video-wrap', { ...bounds }, T)`.
Initial bounds should be set inline on the element to match card-01's
layout. Pick a transition duration of 0.5–0.7s with `ease: 'power2.inOut'`.

**Decorative frames** (`clean` / `hairline` / `polaroid`) sit as a
**sibling** of `#video-wrap` and follow it through layout transitions.
See
[`references/frames/`](references/frames/) for each frame's placement
HTML, suggested CSS, and which layouts it pairs with. Quick rule:
`overlay` layout suppresses decorative frames (the full-bleed video
clashes with chrome); PiP layouts already have their own pill treatment
(border-radius + white ring + shadow), so add a decorative frame only on
top of `split` / `stack`.

**GSAP target lookup table** for `#video-wrap` per composition layout
(landscape 1920×1080 — for portrait & 4:5 see `references/layouts/*.html`
which list all three ratios):

| composition layout                   | typical card.zone | `#video-wrap` GSAP target                                                 | extra css class                            |
| ------------------------------------ | ----------------- | ------------------------------------------------------------------------- | ------------------------------------------ |
| `split`                              | `side-panel`      | `{ left: 960, top: 0, width: 960, height: 1080 }`                         | —                                          |
| `stack`                              | `lower-third`     | `{ left: 14, top: 14, width: 1892, height: 548 }` (top 52%)               | —                                          |
| `pip` (bottom-right)                 | `fullscreen`      | `{ left: 1480, top: 760, width: 400, height: 300 }`                       | `pip-pill` (border-radius + ring + shadow) |
| `pip` (top-left)                     | `fullscreen`      | `{ left: 40, top: 40, width: 400, height: 300 }`                          | `pip-pill`                                 |
| `overlay` (video full-bleed)         | `video-overlay`   | `{ left: 0, top: 0, width: 1920, height: 1080 }` (no change from default) | —                                          |
| **hide video** (pure-graphic moment) | `fullscreen`      | `{ opacity: 0 }` (or move off-canvas)                                     | —                                          |

To toggle the pip-pill chrome (border-radius + white ring + drop shadow)
when entering or leaving a pip moment:

```js
// Enter pip — add chrome
tl.set("#video-wrap", { className: "video-wrapper pip-pill" }, T);
tl.to(
  "#video-wrap",
  { left: 1480, top: 760, width: 400, height: 300, duration: 0.6, ease: "power2.inOut" },
  T,
);

// Leave pip — back to clean full-bleed
tl.set("#video-wrap", { className: "video-wrapper" }, T_NEXT);
tl.to(
  "#video-wrap",
  { left: 0, top: 0, width: 1920, height: 1080, duration: 0.6, ease: "power2.inOut" },
  T_NEXT,
);
```

**Card-host bounds match the zone**. Resolve the card's `zone` into
pixel bounds using the table at the top of Step 6, then write those
into the card-host's inline `style="left:Xpx;top:Ypx;width:Wpx;
height:Hpx;..."`. For `video-overlay` zone (overlay recipe), the
card-host fills the full canvas — your CSS inside `.card .root`
decides where the actual visible card sits.

#### HyperFrames Layout / Animation QA Rules

- Build each card's static hero frame first: the moment where the card is fully visible and readable.
- Confirm video, cards, subtitles/captions, and diagrams do not unintentionally overlap.
- Confirm hidden video areas are clipped by the frame and not visible outside intended bounds.
- Register one paused master timeline as `window.__timelines["talking-head-recut"]`.
- Build timelines synchronously at page load; no `async`, `setTimeout`, Promises, or media `play()` calls.
- Do not use `Math.random()` or `Date.now()` in render paths.
- Do not use `repeat: -1`; calculate finite repeats from the video duration.
- Prefer GSAP transforms and opacity (`x`, `y`, `scale`, `rotation`, `opacity`) over layout properties (`top`, `left`, `width`, `height`) for motion.
- Animate wrappers such as `#video-wrap`, not the video element dimensions directly.
- Avoid animating the same property on the same element from multiple timelines at the same time.
- Use `data-track-index`, not `data-layer`; use `data-duration`, not `data-end`.
- Every timed element (`card-host`, sub-composition, etc.) MUST include `class="clip"` alongside its own classes — e.g. `class="card-host clip"`. The HyperFrames runtime uses `.clip` to gate visibility to the `data-start … data-start+data-duration` window. Without it the element is visible for the whole video (lint: `timed_element_missing_clip_class`).
- For body / global `font-family`, list **concrete font names** (`'Inter', 'Caveat', …`) — not a CSS variable like `var(--font-family)`. The HyperFrames font resolver doesn't expand CSS vars during static analysis (lint: `font_family_without_font_face`). Cards may still use `var(--font-family)` internally since their `@font-face` declarations are loaded.

### 10. Render to MP4

```bash
cd "$WORK_DIR"
PRODUCER_BROWSER_GPU_MODE=hardware npx hyperframes render public \
  --skill=talking-head-recut \
  -o output.mp4 \
  --fps 30
```

`hyperframes render <dir>` reads `<dir>/index.html` and produces the MP4.
The flag `PRODUCER_BROWSER_GPU_MODE=hardware` (or `--browser-gpu`) is
strongly recommended on macOS — software-only Chrome rendering times out
on most laptops.

For a sanity check before the full render, capture a single frame at a
specific timestamp:

```bash
npx hyperframes snapshot public --at 5    # → public/snapshots/frame-00-at-5s.png (a single --at ignores --out)
```

### 11. Report Results

Tell the user:

- Work directory path
- `storyboard.json` (the card outline you designed)
- `public/cards/*.html` (one HTML per card)
- `public/index.html` (the assembled composition)
- `output.mp4` (the final video)
- ASR provider used
- Card count + how you chose them (in 1 sentence)
- Any missing keys or quality caveats

**Optional live preview (on request only).** The clip plays unchanged inside `public/index.html` with the overlays on top, so it previews faithfully. **Don't open it during the run.** When the user asks, start a long-lived server **after** render and report the URL:

```bash
(cd "$WORK_DIR/public" && npx hyperframes preview)   # or `npx hyperframes play` for a shareable link
```

Do not delete the work directory unless the user asks.
