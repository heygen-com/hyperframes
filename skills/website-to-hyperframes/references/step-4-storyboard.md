# Step 4: Write the Storyboard

**Before writing anything, fully re-read these files:**

- **DESIGN.md** — your color palette, font rules, components, Do's/Don'ts. Every creative decision must be grounded in this brand identity. If it says "white backgrounds with purple accent" — plan light scenes, not dark moody ones.
- **`capture/extracted/asset-descriptions.md`** — read EVERY line. This is your menu of available visuals. Each line describes what the image actually shows (e.g., "translucent ribbons in orange, pink, and purple on white background" or "a high-speed train under a dark starry sky"). Use these descriptions to decide which assets belong in which beat. Assets you don't understand from the description — view them directly before assigning.
- **[techniques.md](../../hyperframes/references/techniques.md)** — 11 visual techniques (SVG path drawing, Canvas 2D art, CSS 3D, per-word typography, Lottie, video compositing, typing effect, variable fonts, MotionPath, velocity transitions, audio-reactive). Pick 2-3 per beat and specify them in the storyboard.

The storyboard is the creative north star. It tells the engineer exactly what to build for each beat — mood, camera, animations, transitions, assets, sound. Write it as if you're briefing a motion designer who's never seen the website.

Save as `STORYBOARD.md` in the project directory.

---

## Global Direction

Every STORYBOARD.md starts with global settings:

```markdown
**Format:** 1920×1080
**Audio:** [TTS provider] voiceover + underscore + SFX
**VO direction:** [voice character — e.g., "mid-age male, calm confident delivery,
Apple keynote register — economy of words, silence between sentences is a feature"]
**Style basis:** DESIGN.md (brand colors, fonts, components from the captured site)
```

**Global guardrails** — read [video-composition.md](../../hyperframes/references/video-composition.md) first. It defines the medium rules: density, color presence, scale, frame composition, and how design.md is brand truth not layout spec. Then apply these capture-specific additions:

- Use as many captured assets as the creative vision allows. Scatter framework icons around a dashboard. Layer enterprise photos behind stats. Use product screenshots as floating cards. The assets exist — use them generously.
- Use at least 2-3 different techniques from techniques.md per beat — not across the whole video, per beat. Don't default to basic fade/scale/opacity — mix in SVG path drawing, CSS 3D transforms, typing effects, counter animations, canvas procedural art. Each beat should feel like its own visual world.

**Underscore/music direction** (if applicable):

- Describe the mood, reference artists, when it swells or drops
- Example: "Minimal electronic. Warm sustained pad already playing when the video starts. Sits underneath everything, never competing with VO. Swells gently during the flex section, drops to near-nothing for the comparison, resolves on a final chord."

---

## Asset Audit

Before writing any beats, audit every captured asset. Print this table:

| Asset                          | Type       | Assign to Beat | Role                                  |
| ------------------------------ | ---------- | -------------- | ------------------------------------- |
| wave-fallback-desktop.png      | Hero image | Beat 1         | Full-bleed animated background        |
| enterprise-accordion-hertz.png | Photo      | Beat 3         | Enterprise credibility, Ken Burns pan |
| stripe-logo.svg                | SVG        | Beat 1, Beat 5 | Brand mark opener + closer            |
| datavizstatic3x.png            | Data viz   | Beat 3         | Supporting visual behind stats        |
| icon-3.svg                     | Icon       | SKIP           | Decorative, too small                 |

**Minimum utilization:**

- At least 50% of product screenshots and hero images must appear
- Brand logo appears in the first AND last beat
- The site's signature visual (gradient wave, hero illustration, key product UI) must appear — it's the most recognizable brand element
- Maximum 2 consecutive text-only beats. The 3rd must contain a visual asset
- Opening beat must contain a visual asset, not text-only

---

## Per-Beat Direction

Read [beat-direction.md](../../hyperframes/references/beat-direction.md) for the general beat template: concept, mood, animation choreography (energy verbs), transitions (shader vs CSS vs hard cut decision matrix), depth layers, SFX cues, rhythm planning, and velocity-matched transitions.

In the capture pipeline, each beat also includes:

### VO cue

Which narration line plays over this beat.

### Visual description

What the viewer sees — described cinematically, not as CSS specs. Use camera language (pan, zoom, drift, settle). Describe at least 5 visual elements, not just text + background. Think in layers — what's moving in the foreground, midground, background simultaneously?

### Assets

Which captured files to use, referenced by filename:

- "Background: `capture/assets/wave-fallback-desktop.png` — full-bleed, slow zoom 1→1.04 over beat duration"
- "Logo: `capture/assets/svgs/stripe-logo.svg` — centered, fades in at 0.5s"
- "Enterprise photo: `capture/assets/enterprise-accordion-hertz.png` — Ken Burns pan, 70% opacity overlay"

---

## Production Architecture

Include this file tree at the bottom of the storyboard:

```
project/
├── index.html                    root — VO + underscore + beat orchestration
├── DESIGN.md                     brand reference (from Step 2)
├── SCRIPT.md                     narration text (from Step 3)
├── STORYBOARD.md                 THIS FILE — creative north star
├── transcript.json               word-level timestamps (from Step 5)
├── narration.wav                 TTS audio (from Step 5)
├── capture/                      captured website data (from Step 1)
│   ├── screenshots/
│   ├── assets/
│   │   ├── svgs/
│   │   ├── fonts/
│   │   ├── lottie/
│   │   └── videos/
│   ├── extracted/
│   │   ├── tokens.json
│   │   ├── visible-text.txt
│   │   ├── asset-descriptions.md
│   │   ├── animations.json
│   │   ├── assets-catalog.json
│   │   └── detected-libraries.json
│   ├── AGENTS.md
│   └── CLAUDE.md
└── compositions/
    ├── beat-1-hook.html
    ├── beat-2-features.html
    ├── ...
    └── captions.html
```

---

## Example: Beat-by-Beat Format

Here are three beats from a production storyboard showing the level of detail expected.

### BEAT 1 — COLD OPEN (0:00–0:05)

**VO:** "Your AI agent already knows how to make videos."

**Concept:** We're already in motion when the video starts. No title card, no fade from black. We're mid-flight over an infinite creative workspace — dozens of living compositions scattered below us like a city seen from a drone. Each one is alive, running a different animation. The message is clear before any words: this tool makes videos. Lots of them.

**Visual:** Slow smooth diagonal drift over a vast canvas (3600×2200px plane). Scattered across it: 25 composition cards at organic angles (±5-15° rotation), soft shadows, thin borders. Each card contains a DIFFERENT running animation — kinetic type, gradient morph, data viz, particle system, logo assembly, SVG drawing, shader noise, 3D rotating object. Depth-of-field: close cards slightly blurred, focal sweet-spot in mid-distance, far cards smaller and desaturated.

**Camera:** Diagonal drift top-left to bottom-right, slight 2-3° rotation over 5s. power1.inOut ease. Zoom accelerates in final second as we approach one specific card.

**Assets:** Product screenshots and logo on cards. Each card is a mini-composition with its own animation.

**SFX:** Ambient warmth pad already playing. Faint textured hum — overhearing creative activity from a distance.

---

### BEAT 5 — THE THESIS (0:20–0:24)

**VO:** "Anything a browser can render can be a frame in your video."

**Mood:** Big statement. This sentence gets its own canvas. Clean, spacious, typographic.

**Visual:** Words appear as staggered kinetic typography. "Anything a browser can render" — distinctive serif, gentle fade + rise (y: 24px → 0, opacity 0 → 1, 0.4s, power2.out). Held beat — one second of stillness. "can be a frame in your video." appears below. As the final word lands, the entire text pulses once — a brief warm flash, subtle scale bump to 101%.

**Transition OUT:** Whip pan left — x:-400, blur:24px, opacity:0.4, 0.3s power3.in

**SFX:** Silence under the first line. On the capture pulse — a soft analog shutter click.

---

### BEAT 7 — THE CONTRAST (0:38–0:44)

**VO:** "No new framework for the agent to learn. Just HTML."

**Mood:** Clean comparison. Light base. Two worlds side by side.

**Visual:** Left half: dense code, small, compressed, overwhelming. Scrolls slowly upward. Slightly desaturated. Right half: spacious HTML, syntax-highlighted, generous line spacing, inviting. On "Just HTML." — the left side folds inward along its center line, like a book closing. The right side expands to fill the frame. Warm glow rises behind it.

**Transition IN:** Zoom through — scale 0.75→1, blur 20px→0, 0.5s expo.out
**Transition OUT:** Velocity-matched upward — y:-150, blur:30px, 0.33s power2.in

**Assets:** Real framework code on the left (actual content, not lorem ipsum). Real HyperFrames HTML on the right.

**SFX:** Left side carries a faint low drone. On fold: drone cuts. Silence. Then a single clean chime as the right side expands.
