# Vox style features (gpt-5-pro, 2026-07-16)

## 1) Visual grammar
- Materials/texture: layered “paper” planes (index cards, newsprint, folder tabs, tape). Subtle fiber/grain; light vignette. Drop-shadows soft and short to feel taped-down, not floating (1080p: y-offset 6–12 px, blur 8–16 px, opacity 25–40%). 3–5 depth layers max.
- Cutouts: photo cutouts with rough or offset stroke; occasional torn-edge alpha for emphasis. Hand-drawn arrows/circles to mark details.
- Palette: high-contrast neutrals with one bright accent (often yellow) and 1–2 secondary accents (teal/coral). Backgrounds off-white/gray; sparing use of pure black.
- Archival treatment: archival clips framed as “object-on-table” (polaroids, microfilm frames). Light film grain and halftone; date/location label; scribbles/highlight strokes to guide attention.
- Maps: simplified basemaps, minimal labels. Highlight region with single accent fill or stroke. Route lines round-capped; arrows understated. Dots 6–14 px; choropleth 4–5 bins, single-hue ramp.
- Charts: flat, minimal. Emphasize one series in accent; others gray. Thin gridlines (10–15% opacity). Heavier baseline. Data annotations via callouts/underlines; units on-axis, not in legend. Bars 12–32 px; strokes 2–3 px.

## 2) Typography
- Roles: 
  - Display/headline: bold/condensed sans for slates and big labels.
  - Body/labels: neutral grotesk sans.
  - Quotes/attribution: contrast weight or italic; smaller.
- Conventions: mostly sentence case; short all-caps for chips/keys. Left-align; ragged right. Numbers heavy and large vs text.
- On-screen text amount: keywords, numbers, 1–2 short lines per beat (3–12 words). Full sentences rare except quotes.
- Sizes at 1080p: headline 80–120 px; section slugs 48–72 px; labels 28–44 px; captions 26–32 px; subtitles 34–42 px (2-line max).
- Spacing: line-height 0.95–1.1 for display, 1.15–1.25 for captions. Tracking tight for display (−5 to −20), loose for all-caps (+20 to +40).
- Data labels: round smartly (0–1 decimals); units in parentheses; thin spaces for thousands; consistent style across the piece.
- Safe areas: keep text 64–96 px from edges (16:9).

## 3) Motion grammar
- Framerate: comp 24 or 30 fps; elements often “stepped” to 12–15 fps to suggest stop-motion while camera stays smooth.
- Entrances/exits: slides, pops, tape “peels,” masked wipes with torn-edge mattes. Durations 6–12 frames for small labels, 12–20 frames for panels. Ease-in-out with slight overshoot/settle.
- Camera: gentle 2D pans and 1.03–1.08x pushes; subtle parallax across layers.
- Transitions: mostly hard cuts; occasional paper-whip, page-turn, or match-cut to a new card/map.
- Pacing: 1 idea per 2–4 s; micro-beats every 0.4–0.8 s (label appears, underline draws). Chapter shifts ~15–30 s. Hold on key charts 2–3 s post-VO line.

## 4) Narration & writing
- Hook patterns (first 5–12 s): surprising stat; “why this map explains X”; zoom into a tiny detail that flips the framing; first line often answers a felt question.
- Structure: Problem/claim → Why now/Context → Mechanism (how it works) → Evidence (data/maps) → Counterpoint/limits → Stakes/implications → What to watch next.
- Data anchors: 1 canonical chart/map revisited 3–5 times, updated as understanding grows.
- Sentence design: concrete nouns/verbs; short clauses; each clause drives a visual change. Jargon defined once, then replaced by a shorthand label chip.
- WPM: 155–175 baseline; bursts 185–200 for lists; 250–400 ms micro-pauses to land visuals.
- Endings: return to the hook with a resolved frame, or a conditional “what changes this” outlook; no hard CTA in newsroom pieces.

## 5) Audio
- VO: close, conversational, precise; light smile; minimal room. EQ high-pass ~80 Hz; de-ess; gentle compression. Mix target −16 LUFS integrated; true peak −3 dB.
- Music: light, pattern-based (mallets, pizz strings, soft synth pulses). Tempo 80–120 BPM. Underscore at −12 to −10 dB under VO; sidechain duck 3–6 dB on VO.
- SFX: restrained, tactile (paper rustle, marker squeak, soft whooshes, camera shutter). −24 to −18 dB; accent only on entrances/highlights.
- Silence: brief dips before reveals and at chapter turns.

## 6) 2026 AI paper-collage variant (differences & telltales)
- Visual tells: repeating paper fibers; shadows that flip direction between cuts; edges that “melt” during motion; parallax that ignores occlusion; texture scale inconsistent across zooms; tape with no deformation; fake halftone/grain that sits on the whole frame rather than per-layer.
- Typography tells: micro-flicker in kerning/baseline; inconsistent weights across shots; math/units drift (km vs miles); numerals that change width frame-to-frame.
- Maps/charts: border inaccuracies, missing small islands/enclaves; choropleths with uneven binning; axes without units or with wrong rounding; color ramps shift unintentionally between scenes.
- Motion tells: 12–16 fps stutter on everything (not just elements); easing feels robotic or bezier “S” with no settle; physics-agnostic paper bends.
- Narration/writing: TTS cadence with odd emphasis; hedgy or generic claims; listy structure with weak causal glue; mismatched visuals to VO nouns.
- Audio: room-tone loops; aggressive noise gating; stock whooshes overused; music stems that reset every cut.
- Editorial difference: little original reporting/interviews; heavy reliance on AI stocky B-roll; fewer citations on-screen; fewer returns to a single evolving data anchor.