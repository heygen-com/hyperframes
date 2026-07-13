# The tour pipeline — a video made from the site's own screens

The **tour / showcase angle** of `/product-launch-video`: the video shows the site as-is, built from its captured screenshots and real visuals, instead of selling it with composed scenes. Users ask for it as "turn this website into a 15-second social clip", "make a 30-second site tour from https://…", "capture our homepage and build a video from its own visuals" — and the angle is locked in `BRIEF.md` at the intent layer.

Entered from the main SKILL.md after its Step 0 (Setup) and Step 1 (capture) have run: `BRIEF.md` exists (audience, destination/format, what-to-show confirmed; sign-in shown), and `capture/` holds the site. This file owns the rest of the run — its Steps 0–6 replace the main pipeline's Steps 2–6; Step 0 here is the brand-understanding half of capture, not a re-crawl.

The steps produce artifacts that gate each other. Collaborative runs stop at the gates marked 💬; the mode derives from `BRIEF.md`'s `flow`/`storyboard` (`../../../hyperframes-core/references/brief-contract.md` § 1).

**Autonomous is NOT "skip all gates"** (brief contract § 1). It covers user-preference questions (TTS provider, voice, color emphasis, beat count, music yes/no, captions yes/no — where the agent decides on the user's behalf). It does NOT cover quality-verification gates. The following remain non-skippable in auto mode:

- Asset Audit (Step 3) — viewing contact sheets and justifying USE/SKIP for each asset
- Per-beat HTML read (Step 5) — structured evidence block per beat
- DoD checklist (Step 6) — including animation-map, per-warning WCAG verification, audio/motion playback
- Honest disclosure section (Step 6) — "What I did NOT verify" must appear in your final summary

If you find yourself reasoning "auto mode says bias toward action, so I'll skip X" — and X is a verification gate, not a preference question — that reasoning is wrong. Bias toward action applies to deciding _what to build_, not to deciding _whether to verify_.

---

## Step 0: Understand the Brand

**Read:** [step-0-capture.md](step-0-capture.md)

The capture itself ran at the main pipeline's Step 1. Read the extracted data to understand the **brand and product** — what it does, who it's for, what voice it speaks in, what mood it lives in. The captured assets are a brand toolkit for later, not merely decoration: in this pipeline the site's own screens ARE the building blocks.

**Gate:** Site summary printed — strategy-first (what the product does, who it's for, brand voice) before the asset / color / font inventory.

---

## Step 1: Brand Identity

**Read:** [step-1-design.md](step-1-design.md)

Write DESIGN.md — a brand cheat sheet covering the visual identity: colors, typography, component styles, layout principles. Use `design-styles.json` for exact computed values.

**Speed option:** For fast-pacing videos (billboard-per-beat), DESIGN.md can be a 50-line summary of colors + fonts + do's/don'ts — not a 300-line document. The sub-agent prompt in Step 5 pastes brand values directly, so DESIGN.md depth only matters for complex compositions.

**Gate:** `DESIGN.md` exists (any length) with at minimum: color palette, font choices, and do's/don'ts.

---

## Step 2: Strategy & Messaging

**Read:** [step-2-brief.md](step-2-brief.md), [capabilities.md](capabilities.md) (scan the Table of Contents — deep-dive sections only as needed)

Most of the brief arrived from the intent layer in `BRIEF.md` — audience, destination/format, what to show. This step settles the **declared deferred asks**: the ONE thing this video must say and the narrative arc, confirmed now because the captured site's real content grounds the recommendation. Ask only what `BRIEF.md` doesn't answer.

**Gate:** Video type, duration, format, and — critically — the message and narrative arc are locked. Without those, Step 3 can't write a concept-first storyboard.

---

## Step 3: Storyboard + Script 💬

**Read:** [step-3-storyboard.md](step-3-storyboard.md)

Write the storyboard concept-first: message → narrative arc → beats that serve the arc → techniques per beat → brand accents pass at the end. Then write the narration script to match. Present both to the user with a beat-by-beat summary. Iterate until they approve.

**Gate:** `STORYBOARD.md` + `SCRIPT.md` exist AND the user has approved the plan.

---

## Step 4: VO, Timing + Captions 💬

**Read:** [step-4-vo.md](step-4-vo.md)

If Step 2 said no narration — ask about background music, then skip to Step 5. Otherwise: ask the user which TTS provider (HeyGen TTS, ElevenLabs, or Kokoro), generate audio, transcribe, map timestamps to beats. Then ask about captions.

**Gate:** Either (a) no narration was requested and storyboard has manual beat timings, or (b) `narration.wav` + `transcript.json` exist and beat timings updated with real durations.

---

## Step 5: Build Compositions

**Read:** The `/hyperframes-core` composition contract (load it — every rule matters)
**Read:** [step-5-build.md](step-5-build.md)

Build index.html and compositions following the architecture and pacing chosen in the storyboard (Step 3). Sub-agents run `hyperframes lint` and `hyperframes snapshot` on each beat before reporting back.

**Gate:** Every `compositions/beat-N.html` has been read top-to-bottom by the main agent against DESIGN.md and STORYBOARD.md. The per-beat checklist lives in [step-5-build.md](step-5-build.md).

---

## Step 6: Validate & Deliver

**Read:** [step-6-validate.md](step-6-validate.md)

Lint, validate, take snapshots scaled to video length (formula: `max(beats × 3, ceil(duration_seconds / 2))`), and review each one. Fix issues before delivering. Deliver the localhost Studio project URL — only render to MP4 on explicit user request. Surface that Studio URL **only at handoff** — it is the final, stable preview; the build-phase snapshots are headless, so do not pop a preview mid-build.

**Deliver something you're proud of.** Before handing off, ask yourself: would I post this on social media with my name on it? If not, fix what's wrong.

**Gate:** `npx hyperframes check` pass with zero errors, and the final response includes the active Studio project URL.

---

## Quick Reference

### Video Types

Typical constraints by video type — use as a starting point, not a formula. Beat count should follow from the content and the narration, not from a target range.

| Type                    | Typical duration | Duration driver    | Narration             |
| ----------------------- | ---------------- | ------------------ | --------------------- |
| Social clip (IG/TikTok) | 10–15s           | Platform limit     | Optional              |
| Site walkthrough        | 30–60s           | Script length      | Full narration        |
| Content announcement    | 15–30s           | Content complexity | Full narration        |
| Brand reel              | 20–45s           | Music track        | Optional, music focus |

(A product demo, feature announcement, or launch teaser that _sells_ the product belongs to the promo angles of the main pipeline — the angle in `BRIEF.md` decides.)

Beat count is not in this table intentionally — it should come from the storyboard, not from "social ad = 3-4 beats." A social ad for a complex product might need 5 well-timed beats. A brand reel with one strong visual thesis might need 3.

### Format

- **Landscape**: 1920x1080 (default)
- **Portrait**: 1080x1920 (Instagram Stories, TikTok)
- **Square**: 1080x1080 (Instagram feed)

### Reference Files

| File                                                                                             | When to read                                                                                                                                   |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| [step-0-capture.md](step-0-capture.md)                                                           | Step 0 — capture doctrine, understand the brand and product, write strategy-first site summary                                                 |
| [step-1-design.md](step-1-design.md)                                                             | Step 1 — write DESIGN.md brand cheat sheet (5 sections, 250-350 lines; 50-line fast-path for billboard-style social ads)                       |
| [step-2-brief.md](step-2-brief.md)                                                               | Step 2 — settle message + narrative arc with the user, on capture evidence                                                                     |
| [capabilities.md](capabilities.md)                                                               | Steps 2 & 5 — full inventory of what HyperFrames can do (24 sections). Scan the TOC during the brief, deep-dive specific sections during build |
| [step-3-storyboard.md](step-3-storyboard.md)                                                     | Step 3 — storyboard + script (combined) with user review gate                                                                                  |
| [step-4-vo.md](step-4-vo.md)                                                                     | Step 4 — TTS provider choice, generation, timing                                                                                               |
| [step-5-build.md](step-5-build.md)                                                               | Step 5 — build index.html + compositions                                                                                                       |
| [step-6-validate.md](step-6-validate.md)                                                         | Step 6 — lint, validate, snapshots (scaled to video length), preview                                                                           |
| [techniques.md](../../../hyperframes-animation/techniques.md)                                    | Steps 3 & 5 — primitive animation techniques with code patterns (adapt, don't copy-paste)                                                      |
| [html-in-canvas-patterns.md](../../../hyperframes-animation/adapters/html-in-canvas-patterns.md) | Step 5 — complete code patterns for HTML-in-Canvas effects                                                                                     |
