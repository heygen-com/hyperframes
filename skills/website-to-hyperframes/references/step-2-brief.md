# Step 2: Strategy & Messaging

**First, scan the Table of Contents in [capabilities.md](capabilities.md)** — the 24-row TOC tells you everything HyperFrames can do. You need this to tell users what's possible. Deep-dive specific sections only if a beat needs them.

You've captured the site and you now understand the brand — what the product does, who it's for, what voice it speaks in, what mood it lives in. Before any creative decisions, **align with the user on the story this video must tell.** Captured assets exist as a brand toolkit you'll reach for late in Step 3; they are not what the conversation in this step is about.

**Parse the user's prompt first.** Read what they already told you — video type, style, specific requests, duration. Only ask about things they DIDN'T specify. If they said "product demo, show me the kanban board and chat, moderate pace" — that's most of the brief already. Don't ask "what type of video?" when they literally said "product demo."

Skip questions the user already answered. Ask only what's missing. If the prompt is detailed enough to build from, confirm the direction in one message and move to Step 3. The goal is to fill gaps, not interrogate.

---

## What to Ask

Before asking the user anything, ground yourself in the brand: skim `DESIGN.md` (just written in Step 1) for colors / fonts / voice; read `capture/extracted/asset-descriptions.md` for what visual assets exist; skim `capture/extracted/visible-text.txt` for what the site says about itself. Don't summarize all of it back to the user — that's noise; they captured the site, they know what's there. Use it to draft a tight one-paragraph framing of the brand and proceed to the questions.

Engage the user with the questions below. Use your agent's question/answer UI if available (multi-choice with custom option). If not, ask conversationally.

### Question 1: What's this video for?

Present options based on what makes sense for the captured site:

**Example (Not a required options)**

- **Social ad** (15–20s) — Instagram, TikTok, LinkedIn. Fast, punchy, hook in first 2s.
- **Product demo** (30–60s) — Walk through key features. Narrated, professional.
- **Launch teaser** (15–25s) — Build hype for a new feature or product. Dramatic reveal.
- **Brand reel** (20–45s) — Showcase the brand identity. Visual-forward, minimal narration.
- **Feature announcement** (15–30s) — Highlight a specific feature or update.
- Or describe something else.

This determines duration, beat count, narration density, and overall energy.

### Question 2: What style/vibe?

Ask the user to describe what they want — or react to concrete framings that describe motion and energy, not aesthetic presets.

Do NOT present a labeled menu of styles with pre-filled descriptions ("Cinematic = dark + glow + Apple keynote energy"). Those descriptions become the brief even when they don't match the brand. "Cinematic" for a wellness brand should look completely different from "cinematic" for a security tool — but a label with a baked-in description collapses that distinction.

Instead, ask them approachable open-ended questions:

> "A few questions to get the direction right:
>
> - **Pace:** Should the video move slowly and let moments breathe, or be fast and punchy? Or somewhere in between?
> - **Mood:** What atmosphere matches how you want viewers to feel — dark and dramatic, clean and light, energetic and vibrant, or something else?
> - **Narration:** Should a voice guide viewers through the video, or let the visuals carry it?
> - **Anything specific?** Any moments, techniques, or references you're drawn to? Or say 'surprise me' and I'll work from what I found in the capture."

Their answers modify the brand-derived baseline you built in Step 1. When the user's words conflict with the brand, don't blindly override — let the brand and their direction converge. If the conflict is sharp (user says "dark cinematic" for a brand whose entire identity is white-and-pastel light), surface it and ask before resolving.

### Question 3: What's the ONE thing this video must communicate?

This is the strategy question. Every effective marketing video has a single core message — the one idea that has to land. Every beat serves that idea, or it doesn't belong. Get the user to articulate this BEFORE talking about visuals, assets, or specific scenes.

Frame it like this:

> "From your site, here's the brand frame I'm working from:
>
> - **What the product does:** [one sentence from the site summary — not features, the actual job]
> - **Audience:** [who it's for, derived from copy and visual tone]
> - **Brand voice:** [confident / playful / clinical / urgent / premium — what tone the brand speaks in]
>
> Before we plan visuals, two questions to anchor the story:
>
> 1. **What's the ONE thing this video must communicate?** If a viewer remembers only one sentence after watching, what should it be? (the value prop, a launch announcement, a specific feature claim, a brand feeling, a problem-solution pair, etc.)
> 2. **What's the narrative shape?** Possible arcs: _Problem → Solution_ (most demos), _Reveal_ (launches, teasers), _Demonstration_ (feature showcase, walkthroughs), _Vibe piece_ (brand reels — feeling over information), _Comparison_ (vs. competitor / before-after). Pick or describe your own.
>
> Either give me your own answers, or say 'surprise me' and I'll make the call based on the brand and what you said in Question 1 ([video type])."

Once those answers exist, **then** sketch the composed-beat directions — but ground each one in the message and arc, not in the asset list:

> "Given [the message] and [the arc], here's how I'd shape it:
>
> - [Compose-first sketch grounded in the answer to Q1, e.g., "Open with the problem stated as kinetic typography — 'You waste 4 hours a week on context switches.' Cut to a composed kanban board where cards animate from chaos into organization. Close on the brand mark + tagline."]
> - [Alternative sketch with a different arc, e.g., "Reveal arc: dark canvas → particles converging → product wordmark drawn stroke-by-stroke as the first feature lands. No problem statement — pure announcement energy."]
> - [If user wants demo: "Three composed UI panels — kanban, AI chat, command palette — each in your palette with the brand logo stamped top-left. Narration walks through each. Closer holds the wordmark."]
>
> Brand accents I could layer in: [list 1-3 captured assets that *might* earn a place: the SVG logo for opener/closer, a hero illustration as a depth layer in one scene, a gradient image as an ambient bg wash. Note these are candidates, not assignments — most beats won't need any.]"

**Important:** Lead every direction with **what the beat communicates**, then with **how it's built** (which primitives). The narrow no-go: if your first instinct is "the product-UI screenshot flies in," flip it — compose the UI from divs and CSS instead. That's the slideshow pattern this skill exists to break. For captured logos, illustrations, and hero art, no flip is needed — they're valid primary visuals when the concept calls for them.

The captured assets are a brand toolkit you reach for late in the storyboard, where they serve the concept — never as the starting point of the concept itself.

Present options:

- **I have specific ideas** — let me describe them
- **Surprise me** — you make the creative calls, I'll review the storyboard
- **Let me see some options first** — propose 2–3 different creative directions and I'll pick

### Question 4: Narration?

Not every video needs a voiceover. Ask:

- **Yes, with narration** — a voice guides the viewer through the video (most product demos, launch teasers, feature announcements)
- **No narration, visual-only** — music/SFX only, the visuals tell the story (brand reels, social ads, music-driven pieces)
- **Minimal narration** — just a hook sentence or tagline, rest is visual (short social ads, teasers)

This decision changes the pipeline:

- **With narration:** Step 3 includes a full script. Step 4 generates TTS, transcribes, maps timestamps to beats.
- **Without narration:** Step 3 has no script (VO cues in storyboard are empty). Step 4 is skipped — beat durations are planned manually in the storyboard based on rhythm and pacing.

### Question 5 (if applicable): Format?

Only ask if not already specified by the user:

- **Landscape** (1920×1080) — YouTube, LinkedIn, website embeds (default)
- **Portrait** (1080×1920) — Instagram Stories, TikTok, YouTube Shorts
- **Square** (1080×1080) — Instagram feed, Twitter/X

---

## How to Handle Responses

### "Surprise me" / minimal direction

When the user gives no creative direction, default to what the brand's visual identity and the video's purpose suggest. The minimum context you need before defaulting: **where the video is going** (social feed / landing page / pitch deck / TV ad) and **who it's for** (developers / consumers / enterprise / general audience). If either is missing, ask once — "where will this run, and who's the audience?" — then proceed.

With that minimum in hand, still write an ambitious storyboard. "Surprise me" means "impress me," not "play it safe." Go bold.

**Autonomous mode propagates.** When the user signals "surprise me" / "decide for me" / "just build it" here at Step 2, that signal kills every downstream 💬 gate too — Step 3's storyboard approval, Step 4's TTS provider choice, captions. Make all creative decisions yourself and present the finished video at the end. Do not ask four separate questions across four separate steps. Read the room once and commit.

### Specific direction

If they say something vague ("make it really cool"), push back gently:

> "I want to make sure I nail what you're imagining. When you say 'cool' — do you mean: dramatic/cinematic(slow reveals and dark atmosphere)? Or high-energy (fast cuts and bold motion)? Or something else entirely?"

### Mixed direction

Parse each component separately. "Minimal but with cinematic transitions and a fast feature section" becomes:

- **Base style:** Minimal (moderate pacing, minimal density, elegant motion)
- **Transitions override:** Dramatic (shader effects for key moments)
- **Beats 3–5 override:** Fast pacing, balanced density, energetic motion

Note these per-beat overrides — they go into the storyboard.

### "Let me see options"

Propose 2–3 brief creative directions (3–4 sentences each) with different **narrative arcs** — what story the video tells, not what assets it shows. Each option leads with the message and the arc; visuals are composed scenes that serve them.

> **Option A — Problem → Solution (cinematic, narrated):** Open with the problem stated as kinetic typography over a dark canvas with a single accent glow. Cut to a composed kanban board where chaotic cards animate into organized columns as narration lands the value prop. Closer: brand mark drawn stroke-by-stroke on a shader bloom of the brand gradient. Apple-keynote register. ~25s with full VO.
>
> **Option B — Reveal arc (announcement, music-led):** Cold open: particles converging in darkness, no copy. The product wordmark draws itself across the frame as the first beat lands. Three composed feature panels each unveiled by a hard cut — kinetic typography labels, brand color washes, no screenshots. Closes on the mark + tagline + macOS hint. ~15s, music-driven, minimal narration.
>
> **Option C — Demonstration (narrated walkthrough):** Three composed UI scenes — kanban from cards-as-divs, AI chat with typewriter narration sync, command palette with character-typed search — each in the brand palette with the captured logo stamped top-left as identity. CSS crossfades between. Narration walks each one. ~35s, full VO.

Each option states: the arc, the primary visuals carrying it (composed or captured — whichever fits the beat), and any brand accents layered on top. **Never** an option whose primary content is a pasted product-UI screenshot — if you find yourself writing one, flip it: name what gets composed instead. Captured SVGs, illustrations, hero art, and brand photography are fine as primary visuals when the concept calls for them.

Let the user pick one or combine elements.

---

## Gate

Lock all of these before moving to Step 3. The first three are the strategic frame Step 3 builds the storyboard from — without them, the storyboard cannot land.

1. **Message** — the ONE thing this video must communicate, in a single sentence. (Required. Step 3 fails without this.)
2. **Narrative arc** — Problem→Solution / Reveal / Demonstration / Vibe / Comparison / custom. (Required.)
3. **Audience** — who's watching, where they're watching. (Required.)
4. **Video type** — social ad / product demo / launch teaser / brand reel / feature announcement / etc. Infer from prompt.
5. **Duration** — infer from type if not stated (demo: 30-45s, social: 15-20s, teaser: 15-25s).
6. **Style direction** — pace / mood / specifics — from the user's words, layered onto the brand baseline from Step 1.
7. **Specific requests** — any scenes/effects/beats they explicitly asked for.
8. **Narration** — yes / no / minimal.
9. **Format** — landscape unless specified otherwise.

**Do not ask the user to confirm what they already said.** If the prompt was "make a product demo for huly.io, show the kanban board, dark cinematic feel, full narration" — you already have type (demo), style (dark cinematic), specific requests (kanban board), and narration (full). Still need to derive or ask: the **message** ("the everything app for teams that hate context switches"), the **arc** (Demonstration), and the **audience** (small teams / fast-moving orgs). Proceed to Step 3 only when all 9 are locked.
