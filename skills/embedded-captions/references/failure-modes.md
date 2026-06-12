# Failure Modes — learned the hard way

Things that broke during skill development. Check against this list before you ship.

## Matting

### CoreML execution provider corrupts face alpha

Running the matting ONNX through the CoreML EP partitions the graph across providers; the mixed-precision boundary produced alpha ≈ 30 (out of 255) inside the subject's face while the background correctly read 0 (observed with the previous RVM engine — don't re-try). Result: caption text visibly shines THROUGH the face.

**Fix**: Only ever use `providers=["CPUExecutionProvider"]` for the matting ONNX. Our script does this; don't "optimize" it by adding CoreML.

### Aspect distortion / sharp channel-stride make the alpha garbage

(historical — the PP-MattingV2 engine was replaced 2026-06-12 by hyperframes `remove-background`; kept because the lessons generalize) Two earned scars from the ONNX era: (1) fixed-size model exports — squashing a portrait clip into a landscape canvas distorts humans; contain-pad (aspect preserved, centered, alpha cropped back) instead. (2) sharp returns a **3-channel** buffer from `.raw()` after resizing a 1-channel raw input — reading it with a 1-channel stride silently produces a smeared, striped, displaced matte that can _look_ plausible. Always `toBuffer({resolveWithObject:true})` and stride by `info.channels` (other scripts in this skill still use sharp).

**Fix**: both handled inside `matte.cjs`; preserve them if you touch it.

### isnet-general-use / u2net_human_seg miss props

rembg's general/human models capture the person but drop handheld props (mic, notebook). If the caption crosses the mic, it will NOT be occluded by the mic — text floats in front of it unnaturally.

**Fix**: For scenes where props matter, either (a) accept that the human-matting model captures what it captures, or (b) add a manual mask ROI for the prop region. We haven't productized (b) yet.

## Layout

### Flex-stacked captions push hidden ones into gesture zone

First champion iteration put all cap elements inside a flex column with `display: block`. Hidden captions (visibility: hidden) STILL reserve flex space. Result: cg-4 "dreaming" got pushed to y=700, landing right on the hand gesture zone and getting clipped.

**Fix**: Inside the caption plane, each `.cap` is `position: absolute` at the same coords. Hidden ones don't occupy layout. Both templates in this skill do it this way.

### Header-overlay on close-crop shots

First champion iteration used a full-width header band across the TOP of the frame (`top: 30, left: 40, right: 40, height: 360, rotateX: -3deg, justify-content: flex-start, align-items: center`). Subject's head crosses the center, eating the middle of every caption. "know, for me" became a faint "now, for" with the letters sliced apart.

**Fix**: On close-crop podcast shots, don't use symmetric full-width bands. Use `corner-column-crown` with caption column in the corner opposite the head.

### Text right-align + align-items: flex-end + no max-width → flows off-screen

If you set `align-items: flex-end` on the plane and don't constrain width, each `.cap` shrinks to content width. Long words then extend left beyond the plane's "visible" box without wrapping, clipping into the subject.

**Fix**: Set `max-width: calc(100% - padding*2)` on each `.cap`. Templates do this.

## Animation

### letterSpacing animation causes inline-block reflow jumps

Had `letterSpacing: "0.04em"` as the "from" value in `tl.fromTo(word, {opacity:0, letterSpacing: ".04em"}, {letterSpacing:"0"}, w.start)`. GSAP snaps the "from" state at w.start. The width of the word then changes over the tween → inline-block reflow → the `.cap` line box recomputes → "Some" visibly jumped between rows as "memories" entered.

**Fix**: Animate only **transform** properties (opacity, y, scale). NEVER animate letter-spacing, font-size, or filter:blur on `.w` spans. Templates follow this.

### Double-fade (container × word) produces a non-linear pop

Fading both the group container AND each word independently multiplies: effective_opacity = container.opacity × word.opacity. Even with matched eases, the combined curve is nonlinear and feels like a snap-in around the 40% mark.

**Fix**: Keep container at fixed `opacity: 1` during the group's life (set via `tl.set` just before first word). Animate only per-word opacity. Templates do this.

## Blending

### mix-blend-mode: overlay vanishes into dark regions

`overlay(white_text, black_bg) ≈ black`. If part of the caption falls on a dark shadow / dark prop, the letters disappear. The first champion render had `SHARP` become `ARP` because "S" and "H" landed in the dark mic's shadow.

**Fix**: For scenes with significant dark regions under the caption, use `mix-blend-mode: screen` (which preserves white on dark). `wall-embed` defaults to overlay (for mid-tone walls); `corner-column-crown` defaults to screen (for dark bookshelves).

### Bright backgrounds wash out screen blend

Opposite problem: `screen(white, bright) ≈ white` regardless of the text — letters become invisible on bright backgrounds like sunlit windows or white walls.

**Fix**: If average luminance of the caption region exceeds 180/255, switch CSS to `mix-blend-mode: normal` with an opaque color. Sample the background pixels in the caption bbox across the clip to check.

## Render pipeline

### Frame-rate mismatch between bg render and matte PNGs

If hyperframes renders at 30fps default but the matte was extracted at 24fps source rate, ffmpeg overlay gets a temporal mismatch — alpha from frame N is overlaid on bg content of some fractional frame ≠ N. Result: person's current silhouette and matte silhouette are shifted by a few frames, so the occlusion lags or leads the body.

**Fix**: Always pass `--fps` to hyperframes render matching the source's native FPS (usually 24). `render-and-composite.sh` reads fps from plan.json and passes it through.

### WebM alpha (VP8/VP9) flaky in Chromium

We tried making foreground an alpha-channel WebM. Chromium's support for VP9 alpha is inconsistent; VP8 alpha needs specific metadata the default ffmpeg encode doesn't produce.

**Fix**: Don't try to put the matte inside hyperframes. Do the overlay in post with ffmpeg against a PNG sequence. `render-and-composite.sh` does this.

## Crown / centered text

### Centered crown eaten by body

Default `.crown-plane` in `corner-column-crown` is `left: 0; right: 0; text-align: center`. That mechanically centers the word at `frame_width/2`. If the subject sits right of center (Jobs at x=1100 in a 1920 frame) OR the word isn't wide enough to poke both clean zones, the body eats 50-70% of the crown and it reads as "THE \_\_\_ S".

**Fix**: Check subject center_x vs frame center before choosing crown strategy (see [layout-heuristics.md § Crown placement](layout-heuristics.md)). Either size the crown large enough to cross both clean zones, or shift it into the larger clean zone with a narrower width. Keep `text-align: center` within the (re-positioned) box, not the frame.

### Crown font too small for frame → half-swallowed

On landscape 1920×1080, a centered crown at 140px is only ~500px wide. If the subject is 700-900px wide, the crown vanishes behind them. Symptom: only "THE" and "S" visible for "THE BEATLES".

**Fix**: For full-frame centered crown, font must be big enough that `crown_width > subject_width + 400`. See font-size table in [typography-presets.md](typography-presets.md). Prefer 180-260px for landscape centered crowns.

### Wider caption column + default font size → underweight

Template defaults (66/78/92/140) assume a ~560px column. Expanding the plane to 700+ px without bumping fonts makes the text feel too small relative to the column.

**Fix**: Column width 600-760 → phrase ~108px, emph ~128px, crown ~220px centered. See table in [typography-presets.md](typography-presets.md).

## Scene admission

### Handheld / fast camera → matte alpha flickers

The matte is temporally smoothed (EMA in matte.cjs) but moderate motion only. Fast camera pans (vlog selfie) still produce frame-to-frame alpha jitter that shows as flickering caption edges.

**Fix**: SKILL.md decision gate lists handheld vlog as `⚠️` — degrade or refuse. Production version would add `vidstabdetect` compensation; v1 does not.

### Multi-person scenes → matte is ambiguous

The human-matting model segments "foreground" as a single alpha. With two people, it captures both but they're treated as one blob. Captions can't go "behind person A but in front of person B". If the scene has both speakers visible, the skill should split by shot boundaries first.

**Fix**: Either pre-split with PySceneDetect + per-shot planning, or refuse for `⚠️` multi-subject scenes.

### Undetected shot cut inside the clip

Some sources (interviews, broadcast clips) cut to B-roll/archive footage mid-clip. The matte + caption layout assumes the subject is the same person throughout — a hard cut mid-render creates garbage (caption placement relative to old subject applied to a totally different shot).

**Fix for v1**: Probe the clip at 3-5 timestamps before accepting it. If any frame doesn't contain the primary subject at the same position, trim the clip to end before the cut. `Steve Jobs 60 Minutes` cut to Beatles archival at t≈9s, was manually trimmed to 8.5s.

**Fix for future**: Run PySceneDetect as part of the admission gate; split into shots automatically.

### Pillarbox / letterbox content with baked-in graphics

TV archive clips often have pillarbox (black bars at sides) plus baked lower-third logos ("60 Overtime") and date labels ("2003"). These are part of the video file, can't be matted out, and shrink the usable frame area.

**Fix**: Detect black-bar margins in the first frame (scan rows/columns for all-black). Constrain caption safe-zone to `[left_margin+pad, right_margin-pad, top_margin+pad, bottom_margin-pad]`. For Jobs, safe content zone was x=280-1640 (not 0-1920). Layout positions must respect this.

### transcribe.cjs sees an existing transcript and skips

Transcription is Whisper now, via `transcribe.cjs` (it wraps `hyperframes transcribe` — no API key). `hyperframes init --video <mp4>` may itself auto-write a `transcript.json` in hyperframes' raw whisper shape (a flat word array, no top-level `language_code`). `transcribe.cjs` only treats a transcript as done when it's ALREADY in our normalized schema (`{ words: [...], language_code }`); otherwise it (re-)runs Whisper and normalizes the flat word list into `{ words:[{text,start,end,type:"word"}], language_code }`.

**Fix / expectation**: If you init via hyperframes first, expect `transcribe.cjs` to normalize that transcript into our schema. Don't hand-leave a half-normalized file (e.g. our `words` shape but no `language_code`) — that's the one state the skip-guard can misread.

### Transcript gaps > 3s with no speech

If the original audio has a long silence, leaving the caption plane empty feels wrong mid-video. Either (a) let the prior caption linger, (b) show a title-card crown during the silence, or (c) cut the silence out of the clip.

**Fix**: During caption-grouping, detect silences > 3s. The skill should prompt the user about this, not silently proceed.
