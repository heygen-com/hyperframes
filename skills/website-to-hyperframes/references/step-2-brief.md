# Step 2: Creative Brief

**First, read [capabilities-overview.md](capabilities-overview.md)** — scan the capabilities table to know what's available. You need this to tell users what's possible.

You've captured the site, read all the data, written DESIGN.md. Now you know what you're working with — the brand's colors, assets, animations, typography. Before making any creative decisions, **ask the user what they want.**

Do NOT skip this step. Even when the user gives detailed instructions like "cinematic, dark, 3D MacBook reveal" — that's still not a complete creative brief. They told you the vibe, but not: which features to highlight, whether they want narration, what format, whether they want captions, what specific assets to feature. Ask the questions below to fill the gaps.

The common failure: agents read the user's prompt, rephrase it back ("So you want a cinematic dark video with a MacBook reveal — got it!"), and proceed without actually asking anything new. That's not a creative brief — that's a parrot. Ask questions that surface information the user HASN'T already provided.

---

## What to Ask

After presenting the site summary (from Step 0), engage the user with these questions. Use your agent's question/answer UI if available (multi-choice with custom option). If not, ask conversationally.

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

Instead, ask them across the six axes from [visual-vocabulary.md](visual-vocabulary.md) — framed as approachable questions, not a form:

> "A few questions to get the direction right:
>
> - **Pace:** Should the video move slowly and let moments breathe, or be fast and punchy? Or somewhere in between?
> - **Mood:** What atmosphere matches how you want viewers to feel — dark and dramatic, clean and light, energetic and vibrant, or something else?
> - **Narration:** Should a voice guide viewers through the video, or let the visuals carry it?
> - **Anything specific?** Any moments, techniques, or references you're drawn to? Or say 'surprise me' and I'll work from what I found in the capture."

Their answers modify the brand-derived baseline you built in Step 1. Don't override the brand with their words — let the brand and their direction converge. See [visual-vocabulary.md](visual-vocabulary.md) for how to handle conflicts.

### Question 3: What do you SPECIFICALLY want to see?

This is the open-ended question, but guide the user toward specificity. Frame it like this:

> "Now that I've analyzed your site, here's what I have to work with:
>
> - [N] product screenshots showing [describe what they actually show — be specific]
> - [N] assets: [describe the most interesting ones — hero images, icons, illustrations, photos]
> - [If Lottie found: "Lottie animations at [paths] showing [what they do]"]
> - [If shaders found: "Your site uses WebGL effects — [describe: gradient wave, particle system, etc.] — I can recreate or build on these"]
> - [If videos found: "Product videos showing [content]"]
> - Your brand's visual language: [2-3 sentences on what makes this brand's visual style distinctive]
>
> Based on what I found, the most interesting things I could do with this specific capture:
>
> - [Capability directly tied to something found — e.g., "Your hero gradient wave animation could become a living background driving the whole video" or "The dashboard screenshot would look stunning mapped onto a 3D MacBook with your brand's dark glassmorphism treatment"]
> - [Another specific possibility — e.g., "Your SVG logo has clean paths — I could draw it stroke by stroke as an opener"]
> - [Another — e.g., "You have 6 product feature screenshots — these could fly in as a rapid showcase grid or be revealed one by one on rotating cards"]
> - [If the capture has something unusual: name it specifically]
>
> Beyond what's in the capture, I can also search for or create additional assets — 3D models, custom shaders, stock footage — if anything would make the video stronger. Read [capabilities-overview.md](capabilities-overview.md) for the full picture of what's possible.
>
> Do you have any specific scenes, moments, or effects you want to see? To help you think about it, here are a few directions that would work for your specific site:
>
> [Generate 2–3 example direction prompts grounded in _this_ capture. Each one should reference something the agent actually has access to — an asset, a screenshot, a feature, an effect on the site. The goal is to model the _specificity_ of useful direction, not to suggest these specific moments.
>
> Good capture-grounded examples have the form: "[do something specific] with [an asset/feature/effect that was actually captured]."
>
> Bad examples — what NOT to write here:
>
> - "I want the hero screenshot to come in on a rotating MacBook" (only valid if there are product UI screenshots AND the brand suggests device mockups)
> - "Show the pricing tiers flying in one by one" (only valid if there is a pricing page in the capture)
> - "Start with the logo drawing itself" (only valid if the captured logo is SVG with clean strokes)
>
> The bad examples above are what an agent reaches for when it's not actually thinking about the captured site. Don't paste them — write 2–3 that come from _this_ site's screenshots, assets, copy, or distinctive elements.]
>
> You don't need a complete vision — even one or two specific moments helps me build something you'll love. Or say 'surprise me' and I'll make the creative calls based on your brand."

**Important:** The capabilities you mention must come from what was actually captured. If there are no product screenshots, don't mention the MacBook reveal. If there are no Lottie files, don't mention Lottie. If there are no shaders, don't mention recreating them. Every bullet should be grounded in the actual capture data — generic capability lists feel like a sales pitch, not a collaboration.

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

Default to the safe path that matches the brand and according to what is the video for (this is the minimum requirement users supposed to tell like where does the video goes to, or what audience or occasion or context is it for...):

But still write an ambitious storyboard. "Surprise me" means "impress me", not "play it safe." Go bold.

### Specific direction

Map their words to visual-vocabulary.md dimensions. If they say something vague ("make it really cool"), push back gently:

> "I want to make sure I nail what you're imagining. When you say 'cool' — do you mean: dramatic/cinematic(slow reveals and dark atmosphere)? Or high-energy (fast cuts and bold motion)? Or something else entirely?"

### Mixed direction

Parse each component separately. "Minimal but with cinematic transitions and a fast feature section" becomes:

- **Base style:** Minimal (moderate pacing, minimal density, elegant motion)
- **Transitions override:** Dramatic (shader effects for key moments)
- **Beats 3–5 override:** Fast pacing, balanced density, energetic motion

Note these per-beat overrides — they go into the storyboard.

### "Let me see options"

Propose 2–3 brief creative directions (3–4 sentences each) with different vibes. Example:

> **Option A — Cinematic Launch:** something like dark atmosphere, slow dramatic reveal of the dashboard on a 3D MacBook. Shader transitions between scenes. Bass impacts on key moments. Premium, Apple-keynote energy. or something similar
>
> **Option B — Fast Social Ad:** something like rapid feature showcase — screenshots flying in one after another, bold typography, vibrant accent colors. hook in 2-3 seconds. Instagram-ready.
>
> **Option C — Clean Product Tour:** something like professional walkthrough of key features. Screenshots at full-bleed with smooth transitions. Narrated, moderate pace. LinkedIn/website embed ready. or some conceptual visuals (not screenshots) or something similar

Let the user pick one or combine elements.

---

## Gate

You have all of these before proceeding:

1. **Video type** — social ad, demo, launch teaser, brand reel, or custom
2. **Duration** — explicit or inferred from type
3. **Style direction** — mapped to visual-vocabulary dimensions
4. **Specific requests** — any particular scenes/effects the user wants (can be empty if "surprise me")
5. **Narration** — yes (full), minimal (hook only), or no (visual-only)
6. **Format** — landscape, portrait, or square

Write a one-paragraph **Creative Direction Summary** and confirm with the user:

> "Here's what I'll build: A 25-35s cinematic product demo in landscape. Dark atmosphere matching your brand's design language. Opening with your logo drawing itself, followed by a dramatic 3D MacBook reveal of your dashboard. Middle section: moderate-paced feature walkthrough with clean transitions. Closing with a gradient background and CTA. Full narration with ambient underscore. It's going to go into a production storyboard development to make everything more engaging and interesting. Does this capture what you want, or should I adjust anything?"

Only proceed to Step 3 (Storyboard) after the user confirms.
