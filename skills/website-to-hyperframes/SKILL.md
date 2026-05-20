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

**Sub-agent mode (default):** Step 5 dispatches one sub-agent per beat. Each sub-agent reads [beat-builder-guide.md](references/beat-builder-guide.md), builds, lints, snapshots, and verifies its own beat before reporting back. The main agent assembles the final video and does a final check.

**No sub-agents:** If the user says "no sub-agents", "build it yourself", or the runtime doesn't support parallel agents — the main agent builds all compositions sequentially using the same beat-builder-guide workflow. Same quality, just slower.

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

## Step -1: What we're actually making (REQUIRED before Step 0)

You're not making _a video_. You're making something that **stops scrollers** in the first 1.5 seconds and **feels alive in every single frame** — with motion, depth, momentum, like things exist in a physical world. **Think about how to go viral.** Slow intros are for cinematic trailers; videos shipping anywhere social or feed-based need a hook that beats the 1.5-second scroll threshold.

**Use the captured assets.** Open every SVG in `capture/assets/svgs/`. Open every illustration in `capture/assets/`. Read the descriptions in `capture/extracted/asset-descriptions.md`. Many of these will carry beats outright — the brand logo SVG drawing itself stroke-by-stroke, the hero illustration breathing as ambient depth, the captured gradient as a full-bleed background, the brand mark stamped onto every scene as identity. These are video gold. The capture exists because the brand's actual visual identity matters; using it is what makes the video feel like _this_ brand and not a generic dark cinematic template.

**Compose when there's no captured asset that fits.** For product UI sections where a clean captured asset doesn't exist (kanban boards, chat threads, dashboards, terminals, counters, code editors), build them from divs/SVG/CSS rather than pasting a screenshot. SVG path drawing, kinetic typography, counter animations via `tl.set()`, layered panels, shader-driven gradients — these are all part of HyperFrames' toolkit when no captured asset earns the beat.

**The screenshot trap is specifically about raw product-UI screenshots being pasted as full-bleed beat content.** Captured SVGs, illustrations, logos, hero art, gradients, photography — none of these are screenshots. They're brand assets. Use them. The trap is the "full-bleed dashboard.png + Ken Burns + voiceover" slideshow pattern, not the careful use of captured brand artifacts.

**This is a VIDEO, not a webpage rebuilt in divs.** Composing from divs is the right _medium_ (no screenshots) — but the WRONG outcome is to build a webpage-style layout and animate it 2 pixels. Videos use cinematic grammar: framing, depth, camera movement, scale, atmosphere. A kanban in a video is not "a kanban board centered in the frame at 80% scale with cards breathing 1px" — it's a SHOT: extreme close-up on a card sliding home, then the camera pulls back to reveal the full board, ambient particles + glow + depth give it weight. The composed divs are the subject; the cinematography is what makes it feel like film.

**Specific anti-patterns to refuse, every time:**

- **macOS window chrome** (traffic-light dots, address bars, browser tabs, breadcrumbs) unless the beat IS about the window/browser as the subject
- **Centered layout with chrome around it** — sidebar + header + content area + footer — that's a screenshot reproduced in CSS, not a shot
- **"Breathing" micro-animations** (y: ±1–2px, scale: 1.01) — invisible at 1080p/4K video scale, useless as motion, a sign the sub-agent ran out of ideas
- **Page-level navigation** — sidebars, headers, footers, breadcrumbs, "back" arrows unless the beat is specifically demonstrating navigation
- **"Settled" beats** where nothing moves except a counter pulse — every beat must have continuous, _visible_ motion across the entire duration

**Video grammar to USE in every beat:**

- **Frame the beat as a SHOT** — close-up / medium / wide / over-the-shoulder / Dutch angle. Pick deliberately, not "centered."
- **Camera motion is a primary element** — dolly in, push, parallax pan, orbit, pull-back. The camera moves THROUGH the composition; the composition doesn't sit still in front of the camera.
- **Scale as energy** — enter at 1.4× and settle to 1.0; extreme close-up that pulls back to wide; the subject grows or shrinks through the beat
- **Depth layers** — ambient background atmosphere, focal midground subject, accent foreground element — each moving at different parallax speed
- **Light as choreography** — glow tracks the subject, key moments lit with bloom, transitions happen through light shifts
- **Real motion magnitudes** — 30–100px movements, 0→1 opacity reveals, 0.7→1.0 scale changes — values that READ at video scale. Tiny micro-movements feel like a still image with twitches.

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

**Read:** [references/step-2-brief.md](references/step-2-brief.md), [references/visual-vocabulary.md](references/visual-vocabulary.md), [references/capabilities.md](references/capabilities.md) (scan the Table of Contents — deep-dive sections only as needed)

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

**Gate:** **The main agent does NOT trust sub-agents' chat reports.** After every sub-agent completes, the main agent opens each `compositions/beat-N.html` and reads it top-to-bottom. For each beat: does the GSAP timeline use the data attributes correctly, do the brand colors from DESIGN.md actually appear in the CSS, are the captured assets the storyboard called for actually referenced, is the headline at video-readable size, does the beat serve the storyboard arc? Anything off — fix it inline or re-dispatch the sub-agent with the specific problem quoted.

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

| Step                         | What to ask                                                 | Why                                                                                    |
| ---------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Step 2 (Strategy)            | Message, narrative arc, audience, video type, style, format | The story is what every downstream choice flows from. Without it, beats are arbitrary. |
| Step 3 (Storyboard + Script) | Beat-by-beat approval, script review                        | Cheapest place to iterate. 30s to change a beat, 5min to rebuild a composition.        |
| Step 4 (VO)                  | TTS provider choice, API key if needed                      | Voice quality makes or breaks the video. User may have provider preferences.           |

### Reference Files

| File                                                                               | When to read                                                                                                                                   |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| [step-0-capture.md](references/step-0-capture.md)                                  | Step 0 — capture, understand the brand and product, write strategy-first site summary                                                          |
| [step-1-design.md](references/step-1-design.md)                                    | Step 1 — write DESIGN.md brand cheat sheet (6 sections, 250-350 lines)                                                                         |
| [step-2-brief.md](references/step-2-brief.md)                                      | Step 2 — align on message, narrative arc, audience with user                                                                                   |
| [capabilities.md](references/capabilities.md)                                      | Steps 2 & 5 — full inventory of what HyperFrames can do (24 sections). Scan the TOC during the brief, deep-dive specific sections during build |
| [visual-vocabulary.md](references/visual-vocabulary.md)                            | Step 2 & 3 — translate subjective terms to concrete techniques. Composable building blocks, not rigid presets                                  |
| [step-3-storyboard.md](references/step-3-storyboard.md)                            | Step 3 — storyboard + script (combined) with user review gate                                                                                  |
| [step-4-vo.md](references/step-4-vo.md)                                            | Step 4 — TTS provider choice, generation, timing                                                                                               |
| [step-5-build.md](references/step-5-build.md)                                      | Step 5 — build index.html + compositions                                                                                                       |
| [step-6-validate.md](references/step-6-validate.md)                                | Step 6 — lint, validate, snapshots (scaled to video length), preview                                                                           |
| [techniques.md](../hyperframes/references/techniques.md)                           | Steps 3 & 5 — 20 visual techniques with code patterns (adapt, don't copy-paste)                                                                |
| [html-in-canvas-patterns.md](../hyperframes/references/html-in-canvas-patterns.md) | Step 5 — complete code patterns for HTML-in-Canvas effects (lives in the hyperframes skill)                                                    |
