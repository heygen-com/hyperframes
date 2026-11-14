---
name: changelog-video
description: Turn a weekly changelog .md into the finished weekly HyperFrames video (square 1080, ~45-50 s, the Studio-light look from the hyperframes.studio launch film, real product UI acting out each change, Annie voiceover, music and a sound on every action). Use when the user provides a changelog/digest markdown and wants the weekly video, or says "changelog video". Self-contained: fonts, lexicon, the reference build and its audio script ship in this skill.
metadata:
  internal: true
---

# Changelog → weekly video (v2, Studio light)

Input: a changelog .md (themes + items, like the weekly HyperFrames digest).
Output: a check-clean HyperFrames project in `projects/active/weekly-changelog-<range>/`.
Render only when asked.

The reference build is `examples/v2/`: the Nov 2-9, 2026 week, built as seven scenes
(hook, t1-t5, outro). Every new week starts from a copy of it and replaces the scene
content; the kit (ground, type, window, chips, cursor, pacing, audio script) stays.
`references/look-v2.md` is the look and motion grammar, measured from the site's launch
film. Read both before writing any scene.

The previous dark look (`examples/master-skeleton.html`, `references/build-spec.md`) is
kept for reference only. Do not mix the two.

## The prime directive: show the product doing it

Every highlight is the real HyperFrames UI (rebuilt and decluttered, never a screen
recording) acting out the change: a render matching its preview, an inspector setting, a
Studio tab, a terminal line. Route each item through `references/visualization-registry.md`
first. A text list is the last resort, for items with nothing to show.

## Pipeline

### 0 · Bootstrap from this skill (always)

```bash
P=projects/active/weekly-changelog-<range>
mkdir -p $P/assets/fonts $P/assets/audio $P/assets/sfx
cp -R <SKILL_DIR>/examples/v2/. $P/
cp <SKILL_DIR>/assets/fonts/TT_Norms_Pro_{Light,Normal,Bold}.woff2 \
   <SKILL_DIR>/assets/fonts/tt_norms_pro_mono_regular-webfont.woff2 $P/assets/fonts/
cp <SKILL_DIR>/assets/bgm.mp3 $P/assets/audio/bgm.mp3
cp skills/media-use/audio/assets/sfx/*.mp3 $P/assets/sfx/
```

Never start from a prior week's project or write your own `@font-face`: the copied
`index.html` holds the shared kit CSS (`.k-paper`, `.k-stage`, `.k-hl`, `.k-win`, `.k-bar`,
`.k-dark`, `.k-chip`, `.k-cursor`) every scene uses.

### 1 · Pick the five

- Extract: week range, release count and versions, themes, items.
- Keep **five highlights**, each a change a user will feel. Lead with the one that helps the
  most people. Everything else lives in the digest the outro points to.
- **Budget: 45-50 s.** Hook ~6 s, five scenes of 4-9 s, outro ~6.5 s.

### 2 · Plan the scenes (`BRIEF.md`)

Rewrite the copied `BRIEF.md` (it is the Nov 2-9 plan) for this week, one section per
scene in the same shape: ground (`.k-paper` or `.k-stage`), the headline (one bold run + one light run, 7
words max), the VO line, and the 2-4 timed actions the UI performs, each on a VO phrase.

- **Hook:** the prompt "What shipped in HyperFrames this week?" is typed and sent; the
  release chips land; five flip to the week's themes; one opens into the first scene.
- **Highlight scenes:** a different framing each time (app as a floating card, one pane
  filling the frame, a punch-in on one control, a terminal). The thing that is clicked
  becomes the next shot.
- **Outro:** "That's the week." then the official logo wiped in on the end card with the
  notes URL. The logo appears nowhere else.

### 3 · Two-layer script

Write the VO as token lines per `references/script-voice.md`: conversational, every
technical term with a `spoken` form from `references/lexicon.json`. A term not in the
lexicon: ask how it's said, then add it. Target **~160 words a minute** (about 120 words
for 46 s); faster than ~175 reads as rushed.

### 4 · VO: Annie (HeyGen, pinned)

```bash
node skills/media-use/audio/scripts/heygen-tts.mjs ./vo-spoken.txt \
  -o assets/audio/vo.wav --words vo-words.json \
  --voice 330290724a1b470fb63153f34d4c0183   # Annie (do not substitute)
```

Requires the `heygen` CLI ≥0.3.0, authenticated. `vo-words.json` must hold per-word
`start`/`end`; if it is empty, forced-align with whisper (`uvx --from openai-whisper whisper
assets/audio/vo.wav --model base.en --word_timestamps True --output_format json`).

### 5 · Build

1. Write each scene in `compositions/<id>.html` from the example's patterns: `<template>`,
   `#root`, ids prefixed with the scene id, one paused `tl` registered as
   `window.__timelines["<id>"]`, `gsap.set` for initial states, no timers or randomness.
   Globals: `gsap`, `FrameyV4` (`assets/framey-v4.js`), `Prism` (`assets/prism.js`).
2. Each scene ends with `insertHolds(tl, HOLDS["<id>"])`. Holds are extra seconds inserted
   at a scene-local time so a beat can land before the next line starts.
3. In `tools/build_audio.py`, rewrite the three week-specific blocks: `HOLDS`, `VO_SEGS`
   (the VO file cut at its phrase pauses, from `vo-words.json`) and the `cue(...)` list (a
   sound on each visible action: type, press, land, whip, done; files from `assets/sfx/`).
   Then run `python3 tools/build_audio.py`: it writes every voice phrase, music and sound
   clip into `index.html` and sets each scene's start and length.
4. Headlines carry the meaning, so the video reads muted in Slack, Discord and X autoplay.
   There is no caption rail.

### 6 · Gates (all green before presenting)

1. `npx hyperframes check --json`: 0 errors.
2. `npx hyperframes snapshot --at <one time per scene>` and look at every frame: headline
   readable on a phone (UI text ≥ 22 px), one mint accent per frame, nothing cut off.
3. Render only when asked. Then: loudness about -14 LUFS with peaks under -1 dBFS
   (`ffmpeg -i out.mp4 -af ebur128=peak=true -f null -`), and the voice sits on top of the
   music.
4. Upload to the CDN and embed it at the top of the week's `<Update>` in
   `docs/weekly-updates.mdx`. After any S3 replace, invalidate CloudFront distribution
   `E2BSLVSZ7FG3U0` for that path.

When the digest merges, `.github/workflows/changelog-announce.yml` posts it with the video
to Slack and Discord.

## Project layout

```
projects/active/weekly-changelog-<range>/
├── index.html            # kit CSS, scene hosts, generated audio block, HOLDS
├── compositions/         # hook, t1-t5, outro
├── tools/build_audio.py  # HOLDS, VO_SEGS, cues -> audio clips + scene lengths
├── BRIEF.md              # this week's scene plan
├── script-tokens.json + vo-spoken.txt + vo-words.json
└── assets/ fonts/ audio/{vo.wav,bgm.mp3} sfx/ img/hf-logo-light.svg framey-v4.js prism.js
```

## Anti-patterns

| Don't                                       | Instead                                     |
| ------------------------------------------- | ------------------------------------------- |
| Bullet slides for UI changes                | The real UI acting out the change           |
| The same headline + card layout every scene | A new framing per scene                     |
| UI text under 22 px                         | Headlines 64-72 px, UI labels ≥ 22 px       |
| Cross-fades between scenes                  | The clicked thing becomes the next shot     |
| Logo in a corner on every frame             | Logo only on the end card                   |
| Mint everywhere                             | One mint accent per frame                   |
| A VO over ~175 words a minute               | Cut words or add holds in `build_audio.py`  |
| Hand-placing `<audio>` tags                 | `cue(...)` in `build_audio.py`, then run it |
| Starting from a prior week's project        | Step 0, always                              |
