---
name: website-to-hyperframes
description: |
  Capture a website and create a HyperFrames video from it. Use when: (1) a user provides a URL and wants a video, (2) someone says "capture this site", "turn this into a video", "make a promo from my site", (3) the user wants a social ad, product tour, or any video based on an existing website, (4) the user shares a link and asks for any kind of video content. Even if the user just pastes a URL — this is the skill to use.
---

# Website to HyperFrames

Capture a website, then produce a professional video from it — collaboratively with the user.

**Take your time on thinking and reviewing.** Quality matters more than speed. Read every reference file the steps point to. Look at every snapshot carefully. If a composition looks weak, revise it before moving on. A polished video is worth more than a rushed one delivered 5 minutes faster. That said: don't sit idle on stuck commands — escalate immediately if a process hangs (see Step 4 for escalation order).

**This is a collaborative workflow by default.** At key moments (marked 💬), you stop and ask the user what they want and refine based on their feedback.

**Autonomous mode exception:** If the user says "decide for me", "just build it", "surprise me", or gives any signal they don't want to be asked questions — skip ALL 💬 gates. Make all creative decisions yourself (video type, style, voice, storyboard), and present the finished result for feedback at the end. Do not ask four separate questions across four separate steps. Read the room once and commit.

**This skill requires image-viewing capability** for the validate step (Step 6). If your agent cannot view PNG files, the snapshot review will be blind. Contact sheets (Step 0 and Step 6) are designed to minimize the number of images needed — but some visual verification is unavoidable.

---

## The Creative Tension Principle

Before writing the first beat of any storyboard, answer this in one sentence:

> **"What makes this video different from a generic [video type] for any [industry] brand?"**

If you can't answer it, you haven't thought enough. A product demo for a fintech tool and a product demo for a design tool should not share the same visual DNA. The answer comes from this specific brand's captured assets, its visual language, and what the user said they want — not from a lookup table.

This principle applies at every creative decision point: picking a visual style, choosing transitions, writing beats, building compositions. Every choice should be traceable to something specific about this brand, not just to "this is what I do for cinematic videos."

Users say things like:

- "Capture https://... and make me a 25-second product launch video"
- "Turn this website into a 15-second social ad for Instagram"
- "Create a 30-second product tour from https://..."

---

## Step 0: Capture

**Read:** [references/step-0-capture.md](references/step-0-capture.md)

Run the capture, read ALL extracted data (screenshots, tokens, design styles, text, assets, animations), write a site summary.

**Gate:** Site summary printed. Capture data fully read and summarized.

---

## Step 1: Brand Identity

**Read:** [references/step-1-design.md](references/step-1-design.md)

Write DESIGN.md — a brand cheat sheet with 8 sections: Visual Theme, Color Palette, Typography, Component Stylings (buttons + cards), Layout Principles, Depth & Elevation, Do's/Don'ts, Agent Prompt Guide. Use `design-styles.json` for exact computed values.

**Gate:** `DESIGN.md` exists in the project directory with all 9 sections complete. User review done (colors/fonts/tone confirmed or corrected).

---

## Step 2: Creative Brief 💬

**Read:** [references/step-2-brief.md](references/step-2-brief.md), [references/visual-vocabulary.md](references/visual-vocabulary.md), [references/capabilities-overview.md](references/capabilities-overview.md)

You now know the brand inside-out. Before making any creative decisions, talk to the user. Show them what you found, what assets are available, what HyperFrames can do with them, and ask what they want. Map their words to concrete visual-vocabulary dimensions.

**Gate:** User has confirmed the Creative Direction Summary — video type, duration, style direction, specific requests, format.

---

## Step 3: Storyboard + Script 💬

**Read:** [references/step-3-storyboard.md](references/step-3-storyboard.md)

Write the storyboard (concept-first beats, asset assignments, transitions, depth layers), then the narration script to match — both live in this step because they're coupled. Present both to the user with a beat-by-beat summary. Iterate until they approve.

**Gate:** `STORYBOARD.md` + `SCRIPT.md` exist AND the user has approved the plan.

---

## Step 4: VO, Timing + Captions 💬

**Read:** [references/step-4-vo.md](references/step-4-vo.md)

If the Creative Brief says no narration — ask about background music, then skip to Step 5. Otherwise: ask the user which TTS provider (HeyGen TTS, ElevenLabs, or Kokoro), generate audio, transcribe, map timestamps to beats. Then ask about captions.

**Gate:** Either (a) no narration was requested and storyboard has manual beat timings, or (b) `narration.wav` + `transcript.json` exist and beat timings updated with real durations.

---

## Step 5: Build Compositions

**Read:** The `hyperframes` skill (load it — every rule matters)
**Read:** [references/step-5-build.md](references/step-5-build.md)

Build index.html and each beat composition. Use captured screenshots at full frame size, not CSS recreations. Hero beats use HTML-in-Canvas for cinematic treatment. Every beat needs 25+ GSAP calls with continuous motion.

**Gate:** Every composition self-reviewed. Frames are full, elements readable, concept clear.

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

### User Interaction Points

| Step                         | What to ask                                  | Why                                                                             |
| ---------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------- |
| Step 2 (Brief)               | Video type, style, specific requests, format | Creative direction sets everything. Wrong direction = wasted build time.        |
| Step 3 (Storyboard + Script) | Beat-by-beat approval, script review         | Cheapest place to iterate. 30s to change a beat, 5min to rebuild a composition. |
| Step 4 (VO)                  | TTS provider choice, API key if needed       | Voice quality makes or breaks the video. User may have provider preferences.    |

### Reference Files

| File                                                                | When to read                                                                                                  |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [step-0-capture.md](references/step-0-capture.md)                   | Step 0 — capture, read extracted data, write site summary                                                     |
| [step-1-design.md](references/step-1-design.md)                     | Step 1 — write DESIGN.md brand cheat sheet (9 sections, 200-400 lines)                                        |
| [step-2-brief.md](references/step-2-brief.md)                       | Step 2 — creative brief conversation with user                                                                |
| [capabilities-overview.md](references/capabilities-overview.md)     | Step 2 — what HyperFrames can do (45-line overview). Full 704-line inventory linked inside for deep dives     |
| [visual-vocabulary.md](references/visual-vocabulary.md)             | Step 2 & 3 — translate subjective terms to concrete techniques. Composable building blocks, not rigid presets |
| [step-3-storyboard.md](references/step-3-storyboard.md)             | Step 3 — storyboard + script (combined) with user review gate                                                 |
| [step-4-vo.md](references/step-4-vo.md)                             | Step 4 — TTS provider choice, generation, timing                                                              |
| [step-5-build.md](references/step-5-build.md)                       | Step 5 — build index.html + compositions                                                                      |
| [step-6-validate.md](references/step-6-validate.md)                 | Step 6 — lint, validate, snapshots (scaled to video length), preview                                          |
| [techniques.md](../hyperframes/references/techniques.md)            | Steps 3 & 5 — 20 visual techniques with code patterns (adapt, don't copy-paste)                               |
| [html-in-canvas-patterns.md](references/html-in-canvas-patterns.md) | Step 5 — complete code patterns for HTML-in-Canvas effects                                                    |
