---
name: website-to-video
description: "Capture a general website/URL and turn it into a HyperFrames video (site tour, showcase, or social clip from the site's own visuals). Uses headless Chrome screenshots + brand assets. Use when intent is general — portfolio/blog/landing-page showcase or social clip from the site. NOT for: product/SaaS launch or promo (→ /product-launch-video, even from a URL); topic explainer with no site (→ /faceless-explainer); GitHub PR (→ /pr-to-video); adding captions to existing video (→ /embedded-captions); short unnarrated page-highlight motion graphic (→ /motion-graphics). Unclear launch-vs-general-site? Ask one question or start at /hyperframes."
---

# Website to HyperFrames

Capture a website, then produce a professional video from it.

> **Confirm the route before Step 0.** This skill makes a video _of / from a general site_. If the user is really **marketing / launching / promoting a product** (even from this URL, even "promo for our site") → `/product-launch-video`. A **topic explainer with no site** → `/faceless-explainer`; a **GitHub PR** → `/pr-to-video`; **re-cutting / recoloring / reordering an existing video file** → out of scope. Routed here on a vague "make a video", or unsure launch-vs-general-site? **Read `/hyperframes` first** (full routing table + § What HyperFrames cannot do).

Users say things like:

- "Turn this website into a 15-second social clip for Instagram"
- "Make a 30-second site tour / showcase from https://..."
- "Capture our homepage and build a video from its own visuals"

The workflow has 7 steps. Each produces an artifact that gates the next. By default it's collaborative — gates marked 💬 stop and ask the user. If the user signals autonomous mode ("decide for me", "surprise me"), 💬 user-preference gates are skipped; see step-2-brief.md for how that propagates.

**Autonomous mode is NOT "skip all gates."** Auto mode covers user-preference questions (TTS provider, voice, color emphasis, beat count, music yes/no, captions yes/no — where the agent decides on the user's behalf). It does NOT cover quality-verification gates. The following remain non-skippable in auto mode:

- Asset Audit (Step 3) — viewing contact sheets and justifying USE/SKIP for each asset
- Per-beat HTML read (Step 5) — structured evidence block per beat
- DoD checklist (Step 6) — including animation-map, per-warning WCAG verification, audio/motion playback
- Honest disclosure section (Step 6) — "What I did NOT verify" must appear in your final summary

If you find yourself reasoning "auto mode says bias toward action, so I'll skip X" — and X is a verification gate, not a preference question — that reasoning is wrong. Bias toward action applies to deciding _what to build_, not to deciding _whether to verify_.

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

Lint, validate, take snapshots scaled to video length (formula: `max(beats × 3, ceil(duration_seconds / 2))`), and review each one. Fix issues before delivering. Deliver the localhost Studio project URL — only render to MP4 on explicit user request. Surface that Studio URL **only at handoff** — it is the final, stable preview; the build-phase snapshots are headless, so do not pop a preview mid-build.

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
| [step-1-design.md](references/step-1-design.md)                                    | Step 1 — write DESIGN.md brand cheat sheet (5 sections, 250-350 lines; 50-line fast-path for billboard-style social ads)                       |
| [step-2-brief.md](references/step-2-brief.md)                                      | Step 2 — align on message, narrative arc, audience with user                                                                                   |
| [capabilities.md](references/capabilities.md)                                      | Steps 2 & 5 — full inventory of what HyperFrames can do (24 sections). Scan the TOC during the brief, deep-dive specific sections during build |
| [step-3-storyboard.md](references/step-3-storyboard.md)                            | Step 3 — storyboard + script (combined) with user review gate                                                                                  |
| [step-4-vo.md](references/step-4-vo.md)                                            | Step 4 — TTS provider choice, generation, timing                                                                                               |
| [step-5-build.md](references/step-5-build.md)                                      | Step 5 — build index.html + compositions                                                                                                       |
| [step-6-validate.md](references/step-6-validate.md)                                | Step 6 — lint, validate, snapshots (scaled to video length), preview                                                                           |
| [techniques.md](../hyperframes/references/techniques.md)                           | Steps 3 & 5 — 13 primitive animation techniques with code patterns (adapt, don't copy-paste)                                                   |
| [html-in-canvas-patterns.md](../hyperframes/references/html-in-canvas-patterns.md) | Step 5 — complete code patterns for HTML-in-Canvas effects (lives in the hyperframes skill)                                                    |
