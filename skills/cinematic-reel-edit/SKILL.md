---
name: cinematic-reel-edit
description: Turn a talking-head A-roll plus a folder of AI B-roll clips into a finished cinematic 65s-style reel - word-synced captions, palette-graded B-roll (B&W/crimson), red hero titles, depth text behind the speaker, punch-ins, glitch flickers, SFX, lower thirds, end card, and a premium colour grade on the face. Use when the user drops a talking video plus B-roll and says "edit this", "make it cinematic", "colour grade", or "do it like the last video".
---

# Cinematic reel edit (A-roll + B-roll -> finished video)

Distilled from a real run (Speaker, "My Reel" reel, 1920x960, 65.43s, HyperFrames + ffmpeg + whisper). Everything below was proven. Reuse the files in this skill instead of rewriting them.

## Credit-saving rules (read first)
- Reuse `references/build.py`, `references/prep_broll.sh`, `references/index.template.html`, `assets/*`. Copy, then edit only the beat data. Do not regenerate them.
- Do **not** re-read the whole transcript or old sessions. Everything needed is here.
- Render once. Use `npx hyperframes check` + `snapshot` at 3-4 key frames before any full render (a full render took ~20 min).
- Never add film grain to the A-roll grade (650MB+ encode, timed out). Never run two renders at once.
- Ask the user at most one batch of questions (brief, WhatsApp/site text, brand colours). Otherwise use the defaults below.

## Inputs to collect (one message)
1. A-roll file (talking head). 2. B-roll folder (names like `Man_scrolling_phone_...mp4` are fine; md5 them and skip duplicates). 3. The written brief/addendum if any (hook line, hero words, CTA text). 4. CTA link/handle + site. 5. Speaker name for the depth title. If missing, leave `TODO` placeholders (like `WA_LINK` in build.py) and say so.

## Pipeline (stop at the two gates)

### 1. Prep
- Project dir `edit/`. Copy `references/*` and `assets/*` in. Fonts (Google Fonts, download to `assets/fonts/`): Caveat Brush, Poppins 600/700, Anton, Bebas Neue. SFX via `/media-use`: whoosh, whoosh-short, whoosh-cinematic, impact-bass-1/2, glitch-1/2/3, pop, riser into `assets/sfx/`. Grunge mask `assets/grunge.png`: any distress texture.
- Extract A-roll audio -> `aroll_audio.wav`. Transcribe with word timestamps -> `words.json` (whisper: use `ggml-small.en` or better; `base` dropped words). Snap every cue to a real word start via `wt("word", approx_time)` in build.py; its assert (<0.6s) catches drift.

### 2. Beat plan -> `match_table.json` (**Gate 1: show user, get yes**)
- Beats: each line of speech, its type (A-roll only / needs B-roll / graphic), chosen clip, `clip_in`, cut word. See `references/match_table.example.json`.
- Score each B-roll clip by meaning first, then motion. Each clip used at most once. Human/vertical clips -> `vert` (sharp panel over blurred fill); abstract 16:9 -> `land` (2:1 crop + Ken Burns).
- Alternate A-roll and B-roll; A-roll punch-ins 1.15-1.18 hard cuts on emphasis words, back to 1.0 at each B-roll.

### 3. B-roll grade -> `assets/broll/*.mp4`
Edit the `land`/`vert` list at the bottom of `references/prep_broll.sh`, then run it. Palette mapping: luminance -> `#0A0A0A..#F2EFE8` (BW) or `..#D7261E..` (CRIMSON, used for the chart and "crumbling" clips). Finish: contrast 1.12, vignette, temporal noise 7. Output 1920x960, 30fps, crf 19.

### 4. A-roll colour grade (the "premium" look) -> `assets/aroll_graded.mp4`
Grade **only the A-roll**, never the final composite (it dulls red graphics).
```
ffmpeg -y -i assets/aroll.mp4 -map 0:v:0 -map 0:a:0 \
 -vf "lut3d=assets/Cinematic_Premium_Skin.cube,vignette=angle=PI/4.2" \
 -c:v libx264 -crf 16 -preset fast -pix_fmt yuv420p -g 30 -c:a copy -movflags +faststart assets/aroll_graded.mp4
```
~7 min for 65s. The LUT = filmic S-curve with lifted blacks, teal shadows / warm highlights, skin hue pulled to ~22 deg and saturation compressed (even, warm face), yellow/green desaturated (subject pops from a loud wall), soft vignette. The same `.cube` is installed at `the DaVinci Resolve LUT folder` for DaVinci (Project Settings -> Color Management -> Update Lists, then right-click node -> LUT).
Tweak knobs: moodier = lower the exposure/raise contrast in the LUT script; warmer = shift skin hue target; less teal = reduce shadow tint.
Template line: `<video id="aroll" src="assets/aroll_graded.mp4"`.

### 5. Depth title (name behind the head)
Matte the speaker from a short clip (`depth_src.mp4`) -> `depth_fg.webm` (transparent, `remove_background` / rembg / RVM at best quality). Layer: big name text between A-roll and the matte. If matte quality is poor, put the title above the head.

### 6. Build composition
Edit the data blocks at the top of `build.py`: `BROLL`, `PUNCH`, `SUPPRESS` (caption blackout ranges), `FORCED`, `KEY` words, `HEROES` (red 2-line hero titles: Bebas Neue 220px), `LT_*` lower thirds, `WA_LINK`, `SITE`, `DUR`. Then:
```
cd edit && python3 build.py      # writes index.html, prints removed captions + overlap warnings
npx hyperframes check
npx hyperframes snapshot         # look at frames for each graphic
```
Rules baked into the template: one graphic on screen at a time (priority: end card/lower thirds > hero+depth titles > callouts > captions); captions are 1-2 word pops, key words emphasised; glitch flicker (RGB split + brightness) on B-roll entries, hero hits, "chart", "destination"; single paused GSAP timeline at `window.__timelines["main"]`; deterministic only.
Palette: ink `#0A0A0A`, paper `#F2EFE8`, red `#D7261E`. Aspect 1920x960 (2:1).

### 7. Render (**Gate 2: user watches with sound**)
```
FFMPEG_PROCESS_TIMEOUT_MS=1500000 npx hyperframes render --output renders/final.mp4
```
GPU capture + HW encode ~20 min for 65s. Then loudness pass if needed (aim -14 LUFS, peak <= -1 dBFS) and, for social, `-profile:v high -pix_fmt yuv420p -r 30 -b:v 8M -c:a aac -b:a 192k -movflags +faststart`.

## Known limits (tell the user)
- No eye-contact correction, no per-face skin smoothing (grade is whole-frame; evens tone/warmth only).
- Cannot verify audio sync by ear. Ask the user to listen.
- Free "LUT packs" online target log footage and look wrong on phone video, so we build the LUT instead.

## Related skills
`/talking-head-short` (vertical 9:16 retake-cutting version), `/talking-head-recut`, `/embedded-captions`, `/hyperframes`, `/hyperframes-audio`, `/media-use`.
