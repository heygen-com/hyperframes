---
name: pr-to-hyperframes
description: |
  Create a narrated video walkthrough of a pull request with code slides, diff visualization, and audio narration. Pulls branding from the repo automatically. Use when: (1) the user asks for a PR walkthrough, PR video, or demo video, (2) you're about to create a PR with visual/UI changes and want to suggest a video, (3) the user says "make a PR video", "add a walkthrough", "record a demo for this PR". Triggers on: PR creation with visual diffs, explicit walkthrough requests, or when `gh pr create` is about to run on a branch with UI changes.
---

# PR walkthrough video

Create a narrated walkthrough video for a pull request. This provides the same benefit as a Loom video from the PR author — walking through the code changes, explaining what was done and why, so reviewers understand the PR quickly.

**Input:** A GitHub pull request URL, PR number, or the current branch (auto-detects the PR).

**Output:** An MP4 video at 1280x720 (30 fps) with audio narration, whisper-timed captions, and branded intro/outro slides, saved to `out/pr-<number>-walkthrough.mp4`.

All intermediate files (audio, manifest, scripts) go in `tmp/pr-<number>/` relative to this skill directory. This directory is gitignored. Only the final `.mp4` lives at `out/`.

Run commands that reference `./scripts` or `./video` from this skill directory.

## Branding

**The skill auto-detects branding from the repo.** It never hardcodes project-specific colors, logos, or names. At the start of every run, resolve branding:

1. **Project name** — read `package.json` → `name` field (strip `@scope/` prefix). Fallback: git remote repo name. Fallback: directory name.
2. **Colors** — read `design.md` or `DESIGN.md` if it exists (check both casings). Extract these specific tokens: `text` (body text color), `background` (page/slide background), `accent` (primary brand color for highlights/pills/progress). Map the closest values you find — design files vary in format. Fallback: neutral palette (`#09090b` text on `#ffffff` background, `#3b82f6` accent).
3. **Fonts** — from `design.md` if present. Extract the body/display font and the monospace/code font. Fallback: `"Geist"` for body, `"Geist Mono"` for code.
4. **Logo** — look for `logo.svg` or `logo.png` in repo root, `public/`, `assets/`, `.github/`. If not found, try `gh api orgs/<org> --jq .avatar_url` to get the org's GitHub avatar. If nothing found, use the project name as text.
5. **Repo identifier** — parse `git remote get-url origin` for the `org/repo` slug (e.g., `acme/widget`).

Pass these values to `build.mjs` via a `branding` key in the manifest:

```json
{
  "branding": {
    "name": "widget",
    "org": "acme",
    "repo": "acme/widget",
    "logo": null,
    "colors": {
      "text": "#09090b",
      "background": "#ffffff",
      "accent": "#3b82f6",
      "caption": "#ffd800",
      "captionBg": "#09090b"
    },
    "fonts": {
      "body": "Geist",
      "mono": "Geist Mono"
    }
  }
}
```

The **outro slide** shows the project logo/name and a subtle attribution line:

```
[Project Logo or Name]
PR Walkthrough · #NNN
Made with HyperFrames
```

The **footer bar** shows the project mark + name on the left, and `PR #NNN` on the right. The **PR body** attribution reads:

```html
<sub>Walkthrough by [HyperFrames](https://hyperframes.dev) — write HTML, render video.</sub>
```

This is the only HyperFrames mention. Everything else is the repo's own branding.

## When to suggest (ambient mode)

When you're about to run `gh pr create` or the user asks you to open a PR, check if the branch diff touches visual files:

**Visual file patterns:**

- `*.tsx`, `*.jsx`, `*.vue`, `*.svelte` with JSX/template markup
- `*.css`, `*.scss`, `*.less`, `*.module.css`, `*.styled.*`
- `*.html` files
- Image assets (`*.png`, `*.jpg`, `*.svg`, `*.gif`, `*.webp`)
- Tailwind config, theme files, design tokens
- Storybook stories (`*.stories.*`)
- Component library files

**Skip suggestion** if the diff is purely backend, tests, docs, or dependency bumps.

If visual changes are detected, suggest: _"This PR has visual changes — want me to generate a quick walkthrough video to embed in the description?"_

If the user declines, proceed with the normal PR. Never push.

## Philosophy

**This is a walkthrough from the author's perspective.** The goal is the same as if the PR author sat down with a reviewer and walked them through the changes — showing specific code, explaining what changed and why, in an order that builds understanding.

This means:

- **The narration drives everything.** Write the walkthrough narration first, as a continuous explanation of the PR. Then figure out what should be on screen at each moment.
- **Show the code.** The default visual is a code diff or source file. Text slides are the exception (intro, brief transitions, outro), not the rule.
- **Walk through changes in a logical order**, not necessarily file order or commit order — always anchored to concrete code.
- **Explain the "why", not just the "what".** The code on screen shows what changed. The narration adds the reasoning.

## Workflow

### Step 1: Understand the PR

Read the PR commits, diff, and description. Understand the narrative arc:

- What problem does this solve?
- What's the approach?
- What are the key mechanisms?

```bash
gh pr view <number> --json title,body,commits
git log main..HEAD --oneline
git diff main..HEAD --stat
```

**Skip generated files.** When reading the diff, ignore auto-generated files:

- Lockfiles (`yarn.lock`, `package-lock.json`, `bun.lockb`)
- Generated docs, API reports, changelogs
- Build output, bundled assets, source maps
- Snapshots, schema dumps

If unsure whether a file is generated, check for a "DO NOT EDIT" header. Filter these out when picking which files to feature.

**Resolve branding.** Read `package.json`, `design.md`, check for logos, parse git remote. Build the `branding` object for the manifest.

### Step 2: Write the narration

Write the narration as continuous text, broken into logical segments. Each segment is a beat of the walkthrough. Save this as `tmp/pr-<number>/SCRIPT.md`.

The narration should read like the author explaining the PR to a colleague: "So here's what we're doing... The core problem was X... The approach I took was Y... If you look at this function here..."

Structure: intro → context/problem → code walkthrough → summary. See **Script structure** below.

Avoid redundancy between intro and first content segment.

### Step 3: Generate audio and timestamps

Generate per-segment audio clips with one TTS call per segment:

```bash
./scripts/generate-audio.sh narration.json tmp/pr-<number>/
```

**API key:** Sourced from `.env` file (`GEMINI_API_KEY`).

#### Narration JSON format

```json
{
  "style": "Read the following walkthrough narration in a calm, steady, professional tone. Speak at a measured pace as if the author of a pull request were walking a colleague through the code changes.",
  "voice": "Iapetus",
  "slides": [
    "This pull request adds group-aware binding resolution...",
    "The core problem was that arrow bindings broke when...",
    "If you look at the getBindingTarget method..."
  ]
}
```

- **`style`** — Voice persona and pacing instructions. Keep it short and specific.
- **`voice`** — Gemini voice name (default: `Iapetus`).
- **`slides`** — Array of narration text, one entry per segment.

#### How it works

1. For each segment, the script builds a prompt: style preamble + segment text.
2. One API call to `gemini-2.5-pro-tts` per segment generates a WAV clip directly.
3. Each clip is validated (duration sanity check vs word count) and retried automatically if the output is bad.
4. Leading/trailing silence is trimmed from each clip.

**Output:** Per-segment audio clips (`audio-00.wav`, ...) and a `durations.json` file mapping each audio filename to its duration in seconds.

**Dependencies:** ffmpeg / ffprobe. No Python packages required beyond the standard library.

**Do NOT use** `[pause long]` or `[pause medium]` markup tags — the model may read them aloud literally.

### Step 4: Write the manifest

The manifest is a JSON file that describes every slide in the video. It bridges the narration/audio step and the hyperframes renderer.

**The manifest schema below is the exact format `build.mjs` expects.** Do not invent your own slide structure, nest content in sub-objects, or rename fields. Copy the schema exactly — `build.mjs` reads `slide.type`, `slide.title`, `slide.diff`, `slide.code`, `slide.filename`, `slide.language`, `slide.audio`, `slide.durationInSeconds`, `slide.focus`, `slide.items`, `slide.src`, `slide.subtitle`, and `slide.date` as top-level fields on each slide object.

Read the `durations.json` from step 3 to get the duration (in seconds) for each audio clip. Then write a `manifest.json` alongside the audio files:

```json
{
  "pr": 142,
  "branding": {
    "name": "widget",
    "org": "acme",
    "repo": "acme/widget",
    "logo": null,
    "colors": {
      "text": "#09090b",
      "background": "#ffffff",
      "accent": "#3b82f6",
      "caption": "#ffd800",
      "captionBg": "#09090b"
    },
    "fonts": { "body": "Geist", "mono": "Geist Mono" }
  },
  "slides": [
    {
      "type": "intro",
      "title": "Fix canvas z-index layering #142",
      "date": "May 15, 2026",
      "audio": "audio-00.wav",
      "durationInSeconds": 3.2
    },
    {
      "type": "diff",
      "filename": "packages/editor/editor.css",
      "language": "css",
      "diff": "@@ -12,7 +12,7 @@\n   --z-canvas: 100;\n-  --z-canvas-front: 600;\n+  --z-canvas-front: 250;",
      "audio": "audio-01.wav",
      "durationInSeconds": 25.8
    },
    {
      "type": "code",
      "filename": "packages/editor/src/Editor.ts",
      "language": "typescript",
      "code": "function getZIndex() {\n  return 250\n}",
      "audio": "audio-02.wav",
      "durationInSeconds": 13.5
    },
    {
      "type": "text",
      "title": "Summary",
      "subtitle": "Moved canvas-in-front from z-index 600 to 250.",
      "audio": "audio-07.wav",
      "durationInSeconds": 7.4
    },
    {
      "type": "outro",
      "durationInSeconds": 3
    }
  ]
}
```

#### Slide types

| Type      | Required fields                                              | Description                     |
| --------- | ------------------------------------------------------------ | ------------------------------- |
| `intro`   | `title`, `date`, `audio`, `durationInSeconds`                | Project name + title + date     |
| `diff`    | `filename`, `language`, `diff`, `audio`, `durationInSeconds` | Syntax-highlighted unified diff |
| `code`    | `filename`, `language`, `code`, `audio`, `durationInSeconds` | Syntax-highlighted source code  |
| `text`    | `title`, `audio`, `durationInSeconds`                        | Title + optional `subtitle`     |
| `list`    | `title`, `items`, `audio`, `durationInSeconds`               | Title + numbered items          |
| `image`   | `src`, `audio`, `durationInSeconds`                          | Pre-rendered image (fallback)   |
| `segment` | `title`, `durationInSeconds`                                 | Silent title card between parts |
| `outro`   | `durationInSeconds`                                          | Project branding + attribution  |

#### Animated scroll with `focus`

For longer diffs or code (more than ~30 lines), the renderer keeps the font at a readable 16px and uses an animated viewport that scrolls between focus points. Add a `focus` array to `diff` or `code` slides:

```json
{
  "type": "diff",
  "filename": "src/lib/Editor.ts",
  "language": "typescript",
  "diff": "... 60-line diff ...",
  "focus": [
    { "line": 3, "at": 0 },
    { "line": 25, "at": 0.4 },
    { "line": 50, "at": 0.8 }
  ],
  "audio": "audio-03.wav",
  "durationInSeconds": 30
}
```

- **`line`** — The line number (0-indexed) to center on screen.
- **`at`** — When to arrive at this position, as a fraction of the slide's duration (0 = start, 1 = end).

**When to use focus:** Any diff or code slide with more than ~30 lines.
**When to omit focus:** Short diffs (<=30 lines) fit on screen and don't need scrolling.

#### Writing diff fields

For `diff` slides, paste the **unified diff** for the relevant hunk(s) — the output of `git diff` for that section, including the `@@` hunk header and `+`/`-`/` ` line prefixes. The renderer parses these to apply green/red backgrounds.

```bash
git diff main..HEAD -- path/to/file.ts
```

Include only the relevant hunks. Strip the `diff --git` and `---`/`+++` header lines — start from `@@`.

#### Segment title slides

Insert a **`segment` slide** before each content segment to introduce it — except before the intro and context segments. Each segment slide is **3 seconds of silence** with the segment title centered.

```json
{
  "type": "segment",
  "title": "State machine refactor",
  "durationInSeconds": 3
}
```

#### Segment title labels on code/diff slides

Add a `title` field to `code` and `diff` slides to show a small label in the top-left corner identifying the current segment. Use the same title as the preceding `segment` slide.

### Step 5: Render the video

Run the `render.sh` script:

```bash
./video/render.sh \
  tmp/pr-<number>/manifest.json \
  out/pr-<number>-walkthrough.mp4
```

The script:

1. Copies referenced audio/image files into `video/assets/`.
2. Runs whisper transcription on each audio file → `video/transcripts/audio-NN.json` (idempotent).
3. Runs `build.mjs <manifest>` to generate `video/index.html` — a hyperframes composition with timed clips, GSAP timeline for transitions and code-focus pans, and captions derived from whisper transcripts.
4. Lints and renders 1920x1080 frames via `npx hyperframes render`.
5. Downscales to 1280x720 / 30fps and recompresses with ffmpeg (CRF 26 + AAC 96k).

**Dependencies:** Node.js 22+, ffmpeg, Python 3. `hyperframes` is invoked via `npx --yes`.

### Step 6: Embed in PR

After rendering, embed the video in the PR body:

```bash
# Add to existing PR:
gh pr edit <number> --body "$(gh pr view <number> --json body -q .body)

## Visual Walkthrough

<video src=\"out/pr-<number>-walkthrough.mp4\"></video>

<sub>Walkthrough by [HyperFrames](https://hyperframes.dev) — write HTML, render video.</sub>
"
```

Or include the video section in the initial `gh pr create --body` when creating a new PR.

#### Caption sync via whisper

Captions appear as colored text on a solid dark pill at the bottom. Start/end times come from word-level whisper transcripts grouped into 5-7 word chunks, breaking on natural pauses (>450ms gaps). Whisper may transcribe brand names phonetically — acceptable for captions.

#### File size knobs

Default targets ~30-60 MB for an 8-minute video. To tune:

- `--crf <n>` in the ffmpeg step: 22 is near-lossless, 26 is default, 30+ is smaller.

## File organization

```
pr-to-hyperframes/
├── SKILL.md                    # This file
├── scripts/                    # CLI tools (checked in)
│   ├── generate-audio.sh       # narration.json → per-slide WAVs + durations.json
│   └── make-video.sh           # Static slide + audio assembly fallback
├── video/                      # Hyperframes project (checked in)
│   ├── hyperframes.json        # hyperframes config
│   ├── meta.json               # project meta
│   ├── build.mjs               # manifest.json → index.html composition
│   ├── render.sh               # manifest.json → 720p MP4 (full pipeline)
│   ├── assets/                 # Auto-populated at render time (gitignored)
│   ├── transcripts/            # Whisper word-level JSON (gitignored, cached)
│   └── renders/                # Intermediate 1080p renders (gitignored)
├── out/                        # Final outputs (gitignored)
│   └── pr-XXXX-walkthrough.mp4
└── tmp/                        # Intermediate files (gitignored)
    └── pr-XXXX/
        ├── SCRIPT.md           # Narration script
        ├── narration.json      # Input to generate-audio.sh
        ├── durations.json      # Audio durations
        ├── manifest.json       # Input to render.sh
        └── audio-XX.wav        # Per-segment audio clips
```

## API configuration

- **Gemini API key:** Stored as `GEMINI_API_KEY` in the project root `.env`.
- **TTS model:** `gemini-2.5-pro-tts`
- **TTS voice:** `Iapetus` (default)

## Script structure

The walkthrough follows a consistent narrative arc. 8-12 segments total, with the vast majority showing code.

### Intro (1 segment)

The intro card: project logo/name + PR title + date. The narration should be a single sentence framing what the PR does at a high level.

Manifest slide type: `intro`.

### Context (0-1 segments)

Brief orientation before diving into code. What was the situation before this PR? What problem motivated the work?

- Be concrete: "Arrow bindings broke when the target was inside a group" not "There were issues with bindings"
- Name the area of the codebase affected

If context can be explained while showing the first piece of code, skip the standalone context segment.

Manifest slide type: `text` or `diff`.

### Code walkthrough (6-10 segments)

The bulk of the video. Walk through actual code changes, showing diffs and files while explaining what was done and why.

**Every segment should show code.** Use `diff` slides for changes and `code` slides for unchanged reference code.

- **Name files and functions.** Every segment should reference at least one specific file or function.
- **Show the diff.** Use `git diff main..HEAD -- path/to/file` and extract relevant hunks.
- **Order by understanding, not by file.** Present changes in the order that builds comprehension.
- **Explain the "why", not just the "what".**
- **Skip boilerplate, but mention it.** "There are also some type exports added in `index.ts`."
- **Group related small changes.** If three files got the same one-line fix, one segment covers all three.

### Summary (1 segment)

Brief recap of what the PR accomplished. A sentence or two summarizing the change, mentioning known limitations or follow-up work.

Manifest slide type: `text`.

### Outro (1 segment, silent)

The project logo/name, a subtle "Made with HyperFrames" line, 3 seconds of silence.

Manifest slide type: `outro` with `durationInSeconds: 3`.

## Narration writing tips

- **Be specific about code.** Say "In `BindingUtil.ts`, the `onAfterChange` handler now checks for group ancestors" — not "The binding system was updated."
- **Each segment = one change or closely related group.**
- **Write as the author.** "So the main thing here is..." or "The tricky part was..." are fine.
- **Avoid redundancy** between intro and first content segment.
- **Mention files that aren't shown.** If a PR touches 15 files but only 6 are interesting, briefly acknowledge the others.
- **Duration estimation:** professional narration pace is ~2.5 words/second. Count the words in each segment's narration text and divide by 2.5 to get `durationInSeconds`. Add 1-2 seconds for visual-only moments (intro reveal, diff highlight pause). A 50-word segment ≈ 22 seconds.
- Aim for **5-7 minutes** total narration for large PRs, **1-3 minutes** for small fixes.

## Checklist

- [ ] Resolve repo branding (name, colors, fonts, logo)
- [ ] Read all PR commits and understand the full diff
- [ ] Write narration in SCRIPT.md (8-12 segments)
- [ ] Generate per-segment audio (Iapetus voice)
- [ ] Read durations.json to get per-segment durations
- [ ] Write manifest.json with slide types, diffs/code, audio refs, and branding
- [ ] Render video with render.sh
- [ ] Verify final output: 1280x720 / 30 fps, audio synced, captions readable, outro present
- [ ] Embed video in PR body with HyperFrames attribution
