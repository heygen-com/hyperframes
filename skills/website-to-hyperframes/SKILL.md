---
name: website-to-hyperframes
description: |
  Capture a website and create a HyperFrames video from it. Use when: (1) a user provides a URL and wants a video, (2) someone says "capture this site", "turn this into a video", "make a promo from my site", (3) the user wants a social ad, product tour, or any video based on an existing website, (4) the user shares a link and asks for any kind of video content. Even if the user just pastes a URL — this is the skill to use.
---

# Website to HyperFrames

Capture a website, then produce a professional video from it.

Users say things like:

- "Capture https://... and make me a 25-second product launch video"
- "Turn this website into a 15-second social ad for Instagram"
- "Create a 30-second product tour from https://..."

The workflow has 7 steps. Each produces an artifact that gates the next.

---

## Step 1: Capture & Understand

**Read:** [references/step-1-capture.md](references/step-1-capture.md)

Run the capture, read the extracted data, and build a working summary using the write-down-and-forget method.

**Gate:** Print your site summary (name, top colors, fonts, key assets, one-sentence vibe).

---

## Step 2: Write DESIGN.md

**Read:** [references/step-2-design.md](references/step-2-design.md)

Write a simple brand reference for the captured website. 6 sections, ~90 lines. This is a cheat sheet, not the creative plan — that comes in Step 4.

**Gate:** `DESIGN.md` exists in the project directory.

---

## Step 3: Write SCRIPT

**Read:** [references/step-3-script.md](references/step-3-script.md)

Write the narration script. The story backbone. Scene durations come from the narration, not from guessing.

**Gate:** `SCRIPT.md` exists in the project directory.

---

## Step 4: Write STORYBOARD

**Read:** [references/step-4-storyboard.md](references/step-4-storyboard.md)

Write per-beat creative direction: mood, camera, animations, transitions, assets, depth layers, SFX. This is the creative north star — the document the engineer follows to build each composition.

**Gate:** `STORYBOARD.md` exists with beat-by-beat direction and an asset audit table.

---

## Step 5: Generate VO + Map Timing

**Read:** [references/step-5-vo.md](references/step-5-vo.md)

Generate TTS audio, transcribe for word-level timestamps, and map timestamps to beats. Update STORYBOARD.md with real durations.

**Gate:** `narration.wav` (or .mp3) + `transcript.json` exist. Beat timings in STORYBOARD.md updated.

---

## Step 6: Build Compositions

**Read:** The `hyperframes` skill (load it — every rule matters)
**Read:** [references/step-6-build.md](references/step-6-build.md)

Build each composition following the storyboard. After each one: self-review for layout, asset placement, and animation quality.

**Gate:** Every composition has been self-reviewed. No overlapping elements, no misplaced assets, no static images without motion.

---

## Step 7: Validate & Deliver

**Read:** [references/step-7-validate.md](references/step-7-validate.md)

Lint, validate, snapshot, preview. Deliver the localhost Studio project URL
(`http://localhost:<port>/#project/<project-name>`) to the user first — only
render to MP4 on explicit request. Do not treat `index.html` as the project
handoff link; it is source-code context only.

**Gate:** `npx hyperframes lint` and `npx hyperframes validate` pass with zero errors, and the final response includes the active Studio project URL.

---

## Quick Reference

### Video Types

| Type                  | Duration | Beats | Narration              |
| --------------------- | -------- | ----- | ---------------------- |
| Social ad (IG/TikTok) | 10-15s   | 3-4   | Optional hook sentence |
| Product demo          | 30-60s   | 5-8   | Full narration         |
| Feature announcement  | 15-30s   | 3-5   | Full narration         |
| Brand reel            | 20-45s   | 4-6   | Optional, music focus  |
| Launch teaser         | 10-20s   | 2-4   | Minimal, high energy   |

### Format

- **Landscape**: 1920x1080 (default)
- **Portrait**: 1080x1920 (Instagram Stories, TikTok)
- **Square**: 1080x1080 (Instagram feed)

### Reference Files

| File                                                     | When to read                                                                                                                                                                   |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [step-1-capture.md](references/step-1-capture.md)        | Step 1 — reading captured data                                                                                                                                                 |
| [step-2-design.md](references/step-2-design.md)          | Step 2 — writing DESIGN.md                                                                                                                                                     |
| [step-3-script.md](references/step-3-script.md)          | Step 3 — writing the narration script                                                                                                                                          |
| [step-4-storyboard.md](references/step-4-storyboard.md)  | Step 4 — per-beat creative direction                                                                                                                                           |
| [step-5-vo.md](references/step-5-vo.md)                  | Step 5 — TTS, transcription, timing                                                                                                                                            |
| [step-6-build.md](references/step-6-build.md)            | Step 6 — building compositions with self-review                                                                                                                                |
| [step-7-validate.md](references/step-7-validate.md)      | Step 7 — lint, validate, snapshot, preview                                                                                                                                     |
| [techniques.md](../hyperframes/references/techniques.md) | Steps 4 & 6 — 11 visual techniques with code patterns (SVG drawing, Canvas 2D, 3D, typography, Lottie, video, typing, variable fonts, MotionPath, transitions, audio-reactive) |
