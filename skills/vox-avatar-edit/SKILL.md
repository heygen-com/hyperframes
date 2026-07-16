---
name: vox-avatar-edit
description: >
  A Vox-style paper-collage piece where a real person's TALKING avatar keeps
  their footage untouched and Gemini Omni Flash edit-mode REPAINTS the whole
  world around them into collage — one organic pass per beat, lips and voice
  preserved by remuxing the source audio. Use when the user wants the
  "everything is one painted world" look (style cohesion over text control).
  For deterministic labels/charts/HD → /vox-avatar (HF assembly). Faceless →
  /vox-omni or /vox-explainer. Unclear → /hyperframes.
---

# vox-avatar-edit — Omni edit-mode world repaint around a talking avatar

> **Front door is `/hyperframes`.** Builds on /vox-avatar steps 1–2 (script → per-beat TTS →
> Tokyo talking clips); this skill replaces the matte+assembly stages with Omni video editing.
> Preview gate: show the first edited beat before spending on the rest.

Empirical provenance (VA-1766, 2026-07-16): 27/27 edits zero retries across three prompt
generations; $0.55–0.72 per 4–7s beat, 48–145s per edit. Every rule below was forced by a
measured failure — see `skills DESIGN.md` for the decision log.

## Pipeline

```
script → beats → TTS (person's voice) → Tokyo talking clips (lips)      [= /vox-avatar steps 1-2]
  → per-beat HOST LAYOUT pre-compose (ffmpeg canvas)                    [rule 2]
  → Omni task=edit per beat, CONTENT prompt + restrained style          [rules 1, 3]
  → conform output duration to source + remux source voice              [rules 4, 5]
  → concat (hard cuts)
```

Working script: `scripts/omni_edit_batch2.py <case>` (compose → edit → conform → remux → concat).

## Rules (each one is a measured failure turned guardrail)

1. **Content-aware prompts, not style-only.** Each beat's prompt = a CONTENT paragraph derived
   from the beat's VO ("The collage world tells this beat's story: … ONE hero prop: <object>")
   + the style block. A style-only prompt produces a generic sticker wall unrelated to the
   narration. Describe motifs as OBJECTS, never as words to render.

2. **Host layout is set BEFORE the edit, per beat.** Pre-compose the person onto the target
   canvas with ffmpeg (scale + position: large-center / small-corner / medium-offset), then
   let the edit paint around that composition. The keep-human rule means the model never moves
   or resizes the person — composition variety MUST come from the source. Never the same
   layout on adjacent beats. This also solves aspect ratio: `task=edit` keeps the source AR
   (`response_format.aspect_ratio` is rejected; unpadded square sources get reframed 16:9) —
   so compose at the target AR (e.g. 1080×1920) from the start.

3. **Restraint over density.** ONE hero prop per beat (+ at most one small supporting scrap),
   large flat color fields, "the background stays quiet behind the person". A motif LIST
   produces a cluttered sticker wall; negative space is part of the vox look. Keep-human block
   verbatim: "Keep the talking human in original format exactly where they are placed. Do not
   animate, move, resize or redraw the human. Do not change the person's face, body, clothing
   or lip movements." Plus: "Avoid rendering words or letters; tell the story with objects."

4. **Conform output duration to the source before muxing.** Omni edit re-times its output by
   +0–2.1% (measured across 9 beats) — enough to visibly desync lips by the end of a beat.
   After download: `setpts=PTS*(src_dur/edit_dur)` on the video (residual ≤33ms), then rule 5.

5. **AUDIO CONTRACT: remux the source voice, stream-copied.** Edit output audio is re-baked by
   the model. A "preserve the audio" instruction makes it RE-PERFORM the dialogue word-for-word
   (transcript 100% match) but as a new recording — waveform correlation vs source is 0.149 and
   duration still drifts. That re-performance is what Flow-style "audio consistency" is; the
   source remux (`-map 0:v -map 1:a -c:a copy`) is bit-identical and strictly better. Keep the
   preserve instruction only as a semantic-lossless fallback.

6. **Per-beat editing only** (≤10s per generation). Beats from the /vox-explainer contract
   (4–7s) fit naturally; never feed a multi-beat piece. Each beat is edited independently —
   the collage world CHANGES at cuts, which reads as intentional vox hard-cuts.

## QC gates

- Face/lip spot-check at beat midpoints (person must be pixel-identical; ArcFace ≥0.40 if in doubt).
- Duration delta after conform ≤50ms per beat.
- Hero prop actually matches the beat's narration (content check, not just style check).
- 720p cap on Omni output; HD delivery → /vox-avatar.

## Why not photo→talking in one pass?

Measured: Omni photo→talking generation REDRAWS the person (ArcFace 0.46–0.59 vs source across
i2v / reference_to_video / identity-lock prompts; the lock prompt scored worst). Identity-bearing
hosts must come from real pixels: Tokyo clips (this skill + /vox-avatar) or existing footage.

## Trade-offs vs /vox-avatar (HF assembly)

| | vox-avatar-edit (this) | vox-avatar (HF) |
|---|---|---|
| Style cohesion | one painted world, light interplay | layered collage assembly |
| On-screen text/labels | uncontrolled — avoid text asks | 100% deterministic |
| Cost/beat | ~$0.55 + retries | ~$0 |
| Resolution | 720p | native HD |
| Edit one word | re-TTS + re-Tokyo + re-edit ($) | re-TTS + re-Tokyo + free re-render |
