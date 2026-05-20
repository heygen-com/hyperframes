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

The workflow has 7 steps. Each produces an artifact that gates the next. By default it's collaborative — gates marked 💬 stop and ask the user. If the user signals autonomous mode ("decide for me", "surprise me"), every 💬 gate is skipped; see step-2-brief.md for how that propagates.

---

## Step 0: Capture & Understand the Brand

**Read:** [references/step-0-capture.md](references/step-0-capture.md)

Capture the site, then read the extracted data to understand the **brand and product** — what it does, who it's for, what voice it speaks in, what mood it lives in. The captured assets are a brand toolkit for later, not the building blocks the video is made from.

**Gate:** Site summary printed — strategy-first (what the product does, who it's for, brand voice) before the asset / color / font inventory.

---

## Step 1: Brand Identity

**Read:** [references/step-1-design.md](references/step-1-design.md)

Write DESIGN.md — a brand cheat sheet covering the visual identity: colors, typography, component styles, layout principles. Use `design-styles.json` for exact computed values.

**Speed option:** For fast-pacing videos (billboard-per-beat), DESIGN.md can be a 50-line summary of colors + fonts + do's/don'ts — not a 300-line document. The sub-agent prompt in Step 5 pastes brand values directly, so DESIGN.md depth only matters for complex compositions.

**Gate:** `DESIGN.md` exists (any length) with at minimum: color palette, font choices, and do's/don'ts.

---

## Step 2: Strategy & Messaging

**Read:** [references/step-2-brief.md](references/step-2-brief.md), [references/capabilities.md](references/capabilities.md) (scan the Table of Contents — deep-dive sections only as needed)

Align with the user on **what the video must communicate** before talking visuals or assets. Parse the user's prompt — they probably already gave you the video type and style. Ask only what's missing: the ONE thing this video must say, the narrative arc, and the audience.

**Gate:** Video type, duration, format, and — critically — the message and narrative arc are locked. Without those, Step 3 can't write a concept-first storyboard.

---

## Step 3: Storyboard + Script 💬

**Read:** [references/step-3-storyboard.md](references/step-3-storyboard.md)

Write the storyboard concept-first: message → narrative arc → beats that serve the arc → techniques per beat → brand accents pass at the end. Then write the narration script to match. Present both to the user with a beat-by-beat summary. Iterate until they approve.

**Gate:** `STORYBOARD.md` + `SCRIPT.md` exist AND the user has approved the plan.

---

## Step 4: VO, Timing + Captions 💬

**Read:** [references/step-4-vo.md](references/step-4-vo.md)

If Step 2 said no narration — ask about background music, then skip to Step 5. Otherwise: ask the user which TTS provider (HeyGen TTS, ElevenLabs, or Kokoro), generate audio, transcribe, map timestamps to beats. Then ask about captions.

**Gate:** Either (a) no narration was requested and storyboard has manual beat timings, or (b) `narration.wav` + `transcript.json` exist and beat timings updated with real durations.

---

## Step 5: Build Compositions

**Read:** The `hyperframes` skill (load it — every rule matters)
**Read:** [references/step-5-build.md](references/step-5-build.md)

Build index.html and compositions following the architecture and pacing chosen in the storyboard (Step 3). Sub-agents run `hyperframes lint` and `hyperframes snapshot` on each beat before reporting back.

**Gate:** Every `compositions/beat-N.html` has been read top-to-bottom by the main agent against DESIGN.md and STORYBOARD.md. The per-beat checklist lives in [step-5-build.md](references/step-5-build.md).

---

## Step 6: Validate & Deliver

**Read:** [references/step-6-validate.md](references/step-6-validate.md)

Lint, validate, take snapshots scaled to video length (formula: `max(beats × 3, ceil(duration_seconds / 2))`), and review each one. Fix issues before delivering. Deliver the localhost Studio project URL — only render to MP4 on explicit user request.

**Deliver something you're proud of.** Before handing off, ask yourself: would I post this on social media with my name on it? If not, fix what's wrong.

**Gate:** `npx hyperframes lint` and `npx hyperframes validate` pass with zero errors, and the final response includes the active Studio project URL.

---

## Quick Reference

### Video Types

Typical constraints by video type — use as a starting point, not a formula. Beat count should follow from the content and the narration, not from a target range.

| Type                  | Typical duration | Duration driver    | Narration             |
| --------------------- | ---------------- | ------------------ | --------------------- |
| Social ad (IG/TikTok) | 10–15s           | Platform limit     | Optional              |
| Product demo          | 30–60s           | Script length      | Full narration        |
| Feature announcement  | 15–30s           | Feature complexity | Full narration        |
| Brand reel            | 20–45s           | Music track        | Optional, music focus |
| Launch teaser         | 10–20s           | Hook energy        | Minimal               |

Beat count is not in this table intentionally — it should come from the storyboard, not from "social ad = 3-4 beats." A social ad for a complex product might need 5 well-timed beats. A brand reel with one strong visual thesis might need 3.

### Format

- **Landscape**: 1920x1080 (default)
- **Portrait**: 1080x1920 (Instagram Stories, TikTok)
- **Square**: 1080x1080 (Instagram feed)

### Reference Files

| File                                                                               | When to read                                                                                                                                   |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| [step-0-capture.md](references/step-0-capture.md)                                  | Step 0 — capture, understand the brand and product, write strategy-first site summary                                                          |
| [step-1-design.md](references/step-1-design.md)                                    | Step 1 — write DESIGN.md brand cheat sheet (6 sections, 250-350 lines)                                                                         |
| [step-2-brief.md](references/step-2-brief.md)                                      | Step 2 — align on message, narrative arc, audience with user                                                                                   |
| [capabilities.md](references/capabilities.md)                                      | Steps 2 & 5 — full inventory of what HyperFrames can do (24 sections). Scan the TOC during the brief, deep-dive specific sections during build |
| [step-3-storyboard.md](references/step-3-storyboard.md)                            | Step 3 — storyboard + script (combined) with user review gate                                                                                  |
| [step-4-vo.md](references/step-4-vo.md)                                            | Step 4 — TTS provider choice, generation, timing                                                                                               |
| [step-5-build.md](references/step-5-build.md)                                      | Step 5 — build index.html + compositions                                                                                                       |
| [step-6-validate.md](references/step-6-validate.md)                                | Step 6 — lint, validate, snapshots (scaled to video length), preview                                                                           |
| [techniques.md](../hyperframes/references/techniques.md)                           | Steps 3 & 5 — 13 primitive animation techniques with code patterns (adapt, don't copy-paste)                                                   |
| [html-in-canvas-patterns.md](../hyperframes/references/html-in-canvas-patterns.md) | Step 5 — complete code patterns for HTML-in-Canvas effects (lives in the hyperframes skill)                                                    |
