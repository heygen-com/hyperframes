# Step 3: Storyboard + Script

**Before writing a single beat, answer this in one sentence:**

> "What makes this video different from a generic [video type] for any [industry] brand?"

If you can't answer it, you haven't thought enough. The answer must come from this brand's specific DESIGN.md, captured assets, and what the user said — not from a lookup table. If the only thing you can say is "it uses their colors," that's not enough.

---

**Before writing anything, fully re-read these files:**

- **The Creative Direction Summary** from Step 2 — the user's confirmed video type, style, specific requests, and format. Every creative decision must honor what the user asked for.
- **DESIGN.md** — your color palette, font rules, components, Do's/Don'ts. Every visual must be grounded in this brand identity. If it says "white backgrounds with purple accent" — plan light scenes, not dark moody ones.
- **[visual-vocabulary.md](visual-vocabulary.md)** — translate the user's style direction into concrete dimension values (pacing, density, transitions, mood, motion, audio). Note any per-beat overrides the user requested.
- **`capture/extracted/asset-descriptions.md`** — read EVERY line. This is your menu of available visuals. Each line describes what the image actually shows. Assets you don't understand from the description — view them directly before assigning. It is very important you fully understand what you have to work with
- **[techniques.md](../../hyperframes/references/techniques.md)** — 20 visual techniques with code patterns. Pick for beats, these are starting points to adapt, not templates to copy.
- **[text-effects.md](../../hyperframes/references/text-effects.md)** — 24 named text animation effects bundled in the repo. Read the catalog now and assign a specific effect ID to every headline, label, and copy element in every beat — not generic "fades in" descriptions.

The storyboard is the creative north star. It tells the engineer exactly what to build for each beat — mood, camera, animations, transitions, assets, appearance, sound. Write it as if you're briefing a motion designer who's never seen the website.

**Incorporate the user's specific requests.** If they asked for "a 3D MacBook reveal" — that's in the storyboard. If they said "surprise me" — go ambitious, but just stay within the style direction.

Save as `STORYBOARD.md` in the project directory.

---

## Consider: Would Research Improve This Video?

Before diving into beats, pause and think: **would focused research make this video meaningfully better?**

This is NOT always needed. A simple social ad for a SaaS product probably doesn't need market research. But some videos benefit from context the website alone doesn't provide:

**Research when:**

- The video is for a competitive market — look at how competitors present their product, what visual language the industry uses, what trends are hot
- The video represents a company/product you know little about — search for reviews, press coverage, user opinions, company history to understand what matters to their audience
- The user asked for something specific to their field — a fintech launch video benefits from understanding how Stripe, Ramp, Mercury position themselves visually
- The video needs to reference real-world data, trends, or context not on the website

**Skip research when:**

- It's a straightforward brand reel or social ad from a clear website
- The user gave very specific creative direction ("I want exactly X, Y, Z")
- The website already contains all the context needed (features, stats, testimonials)

**What to research:** Competitor videos in the space, trending visual styles for the industry, audience expectations, any company context that helps you make better creative decisions. A 2-minute web search can give you the edge between a generic video and one that feels like it was made by someone who understands the market.

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

- Use as many captured assets as the creative vision allows. The assets exist — use them generously.
- Use different techniques from techniques.md — not across the whole video, per beat. Don't default to basic fade/scale/opacity — mix in SVG path drawing, HTML-in-canvas, shaders, scrolling effects or movement effect, CSS 3D transforms, typing effects, counter animations, canvas procedural art. Each beat should feel like its own visual world. Use as many as makes sense for the storyboard.

**Underscore/music direction** (if applicable):

- Describe the mood, reference artists, when it swells or drops
- Example: "Minimal electronic. Warm sustained pad already playing when the video starts. Sits underneath everything, never competing with VO. Swells gently during the flex section, drops to near-nothing for the comparison, resolves on a final chord."

---

## Required Capabilities Discovery

Before writing any beats, you have to run these commands and paste the output below the Global Direction section. This tells you what's available beyond the standard techniques.

```bash
# 1. Check available shader transitions (installed in registry/blocks/)
ls registry/blocks/ 2>/dev/null | grep -E 'chromatic|cinematic|cross-warp|domain-warp|flash|glitch|gravitational|light-leak|ridged|ripple|sdf|swirl|thermal|whip' || echo "No shader transitions installed"

# 2. Check available VFX blocks
ls registry/blocks/ 2>/dev/null | grep vfx || echo "No VFX blocks installed"

# 3. Browse what's available to install
npx hyperframes catalog --type block 2>/dev/null | head -40
```

There might be VFX blocks available (vfx-liquid-glass, vfx-iphone-device, vfx-shatter, vfx-portal, etc.), use them for hero treatments instead of basic perspective tilt. You need to install any you want with `npx hyperframes add <name>`. Don't use too many shaders — maximum 2 per video unless user wants differently.

**Shader transitions — block name ≠ shader name.** When you run the commands above and see `domain-warp-dissolve` in `registry/blocks/`, the HyperShader runtime name is `domain-warp` (without "-dissolve"). After installing a block, open its showcase HTML (`compositions/<block-name>.html`) and find the actual shader name used in `HyperShader.init()`. That is what you put in the storyboard. Then delete the showcase file — it's a demo only and will pollute your compositions/ directory with lint warnings.

### HTML-in-Canvas — plan for it here, build in Step 5

The `drawElementImage` Chrome API captures any live HTML/CSS as a GPU-accelerated texture at 60fps. This is HyperFrames' highest-impact capability — it lets you render captured product screenshots or UI through:

- **3D geometry** — a rotating iPhone or laptop model, a sphere, a curved surface
- **WebGL shaders** — liquid glass refraction, shatter into fragments, portal reveal, noise distortion
- **Post-processing** — bloom, depth-of-field, film grain, color grading

When planning beats, decide which ones deserve an HTML-in-Canvas treatment vs. a standard GSAP animation. If you want it, name it in the storyboard — Step 5 will read `html-in-canvas-patterns.md` for implementation. You don't need to specify the API details here.

### SFX assignment — happens here, not in Step 5

**Before writing beats,** read `skills/website-to-hyperframes/assets/sfx/manifest.json` (or your local copy at `sfx/manifest.json` if already copied to the project). Each entry has a filename, duration in seconds, and description. Assign **specific SFX files** to exact moments in the storyboard. Step 5 implements what you specify here — it makes no SFX decisions.

Per beat, specify SFX like:

- `sfx/impact-bass-1.mp3` at `0.2s`, volume `0.35` — on the hero image snapping into frame
- `sfx/chime.mp3` at `3.8s`, volume `0.5` — on the logo appearing

**Less is more.** Most beats need zero SFX. One SFX per beat is typical; multiple only if the beat has genuinely distinct punctuation moments. Never place SFX on shader transitions directly — shader transitions are already an audio-visual event.

**How to place each sound type** (industry-standard rules):

- **Impact/hit sounds** (`impact-bass-1`, `ping`, `pop`, `glitch-*`): peak is at the start of the clip. Trigger exactly at the visual moment. Let the decay tail bleed into the next scene — this is normal, called a J-Cut, and sounds professional. `data-duration` = full manifest duration, never trimmed.
- **Riser/build-up sounds** (`riser`, `whoosh-cinematic`): peak is at the END of the clip. To make the peak land on a climax moment (a transition, a reveal), trigger at `climax_time - sfx_duration`. For `riser.mp3` (10.03s) peaking at a t=20s transition: trigger at t=9.97s.
- **Short accent sounds** (`click`, `click-soft`, `chime`, `sparkle`, `ping`): trigger at the exact visual punctuation moment. Duration is short, no tail concern.

**Volume when SFX overlaps narration:** HyperFrames has no automatic audio ducking. If an SFX plays under spoken narration, set its volume to 0.2–0.3 max, not 0.5+. Specify this in the storyboard entry so Step 5 wires it correctly.

**data-duration rule** (for Step 5 to implement): always equals the manifest's duration field exactly. Never set it shorter to "fit" the remaining beat time — truncating an impact mid-decay is the exact problem causing the cut-off sounds in v2 videos.

### Architecture Constraint: Each Beat is an Independent Composition

Each beat is built as a separate HTML file (`compositions/beat-N.html`). These are loaded independently — they do NOT share state, WebGL contexts, Three.js scenes, or DOM elements with other beats. This means:

- **No "persistent" elements across beats** — you can't have a MacBook model that stays on screen while only the screen content changes between beats 2, 3, 4. Each beat loads its own MacBook from scratch. If you want visual continuity, each beat must independently set up the element at the same position/rotation, so it APPEARS continuous.
- **No shared 3D scenes** — each beat that uses Three.js creates its own renderer, scene, and camera. If beats 2 and 3 both show a rotating laptop, they each load the model independently and must start from matching positions.
- **Shader transitions happen between beats** (in index.html), not within beats. Don't plan a shader transition "inside" a beat.

Plan your storyboard within these constraints. If you describe "the MacBook stays in place while content swaps," you need to specify that each beat independently recreates the MacBook at the same position — not that it persists.

### Device Mockups: Use the Registry Block

If the storyboard calls for a MacBook or iPhone mockup, use the pre-built `vfx-iphone-device` registry block — it has both **iPhone 15 Pro Max AND MacBook Pro** GLTF models with live HTML-in-Canvas screens, camera choreography, and glass lens morphing. Install with `npx hyperframes add vfx-iphone-device`.

Do NOT hand-code a Three.js device scene from scratch. The registry block handles UV mapping, screen textures, lighting, and camera angles correctly. Hand-coded versions consistently produce broken screen textures, wrong UV flipping, and path resolution bugs. Use the block.

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

and outline how many assets you have actually read/view from any sources or yourself.

**Minimum utilization:**

- Use as many assets as applicable for specific video request and concept
- Brand logo appears in the first AND last beat unless the concept of the video is specific or different
- The site's signature visual (gradient wave, hero illustration, key product UI) must appear anyhow — it's the most recognizable brand elements
- Every beat must have a meaning in a bigger picture (full video)
- Every beat must be visually interesting and engaging unless it's on purpose very bold and minimal

---

## Per-Beat Direction

Each beat is a WORLD, not a layout. Write what the viewer EXPERIENCES before you write CSS specs.

**Motion verbs** — every animated element gets one. Pick from the beat's concept, not from an energy bucket:

- **Impact:** SLAMS, CRASHES, PUNCHES, DROPS, SHATTERS
- **Directional:** SLIDES, PUSHES, WIPES, CUTS
- **Reveals:** DRAWS, FILLS, GROWS, ASSEMBLES, COUNTS UP
- **Organic:** FLOATS, DRIFTS, BREATHES, PULSES, ORBITS
- **Mechanical:** TYPES ON, CLICKS, LOCKS IN, SNAPS, STEPS

**Transition decision matrix** — shader vs CSS vs hard cut:
| Shader transition for | CSS crossfade for | Hard cut for |
|---|---|---|
| Hero reveals, logo unveils, "wow" moments | Continuous motion between beats, editorial pacing | Rapid-fire lists, percussive edits, comedy timing |

1–2 shader transitions per video (hero + CTA). Too many flatten their impact. Mix shader and CSS crossfade in one HyperShader composition by omitting `shader` on any transition entry.

**Rhythm** — declare your scene rhythm before implementing: fast-fast-SLOW-fast-SHADER-hold. The rhythm comes from the brand and content, not a template.

Decide the number of beats and their durations based on the pacing from the Creative Brief (Step 2). The pacing dimension maps directly to beat count and duration:

| Pacing       | Beat count | Beat duration | Total  | Architecture                                                                                                                                                              | When                                          |
| ------------ | ---------- | ------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **Fast**     | 8–15       | 0.7–1.8s      | 15–25s | Stacked divs, hard cuts, one focus per frame. Load `/launch-video` skill for the billboard-per-beat pattern.                                                              | Social ads, hype launches, product drops      |
| **Moderate** | 4–6        | 3–5s          | 20–35s | Sub-compositions with CSS crossfade transitions. Multiple elements per beat, sequential entrances.                                                                        | Product tours, demos, explainers              |
| **Slow**     | 3–4        | 5–8s          | 20–35s | Sub-compositions with long crossfades (0.8–1.2s). Ken Burns drift, parallax layers, breathing room before text enters. Continuous subtle motion — nothing is ever static. | Cinematic, premium brand, Apple-keynote style |
| **Arc**      | 5–7        | varies        | 25–40s | Slow opening (5–8s) → building middle beats (3–4s) → fast peak (1–2s) → resolved close (4–6s). Mix architectures per section.                                             | Launch announcements, narrative storytelling  |

**Do not default to moderate.** Read the pacing dimension from the Creative Brief. If the user said "cinematic" or "premium," that's slow — 3–4 beats at 5–8s each. If they said "punchy" or "social ad," that's fast — load `/launch-video`. Most agents default to 5 beats at 3–4s regardless of direction. That's the mushy middle and it produces generic videos.

**Cut the video to match the narration length** — if the script produces 22 seconds of audio, the video should be 24 seconds with a 2-second CTA hold, not 30 seconds with 8 seconds of dead silence. Empty time at the end where nothing is happening loses the viewer.

**Frame-filling rule:** When describing visuals per beat, specify sizes as FRAME FILL PERCENTAGES, not pixels. "Product screenshot fills 80% of frame" not "600px wide card."

**Use captured screenshots over CSS recreations.** The capture folder has real product UI — actual interfaces with real data, real colors, real chrome. You might or might not use them, but if you do, make it at full-bleed (100% frame width) with Ken Burns zoom or perspective tilt or 3D moving rotation or turn or whatever the best way you will find.

**CTA / closing beats** are consistently the weakest. Agents treat them as "logo + tagline + done." A good CTA should: make the logo entrance an event (SVG path draw, scale with overshoot, or anything awesome really), have continuous background motion, and hold only 2-3 seconds after the last spoken word — NOT 8-10 seconds of silence.

**VO start timing — decide here, not in Step 5.** When does the narration actually begin relative to the first visual? Options: (a) VO starts over the visual intro (heard before content settles — creates urgency), (b) VO starts after the visual intro settles (viewer sees the opening, then hears the voice — creates drama), (c) a few seconds of music-only visual before VO enters. None of these is a default — pick based on the brand and the opening beat's concept. State the intended narration start time explicitly in the storyboard's Global Direction, e.g. `**Narration start:** 0.8s (after hero intro settles)`. Step 5 wires this as the audio element's `data-start`.

**Concept-first beats.** Every beat starts with its CONCEPT — not "what technique to use" but "what does this scene should show, what did the previous showed and what will the next show...?" What idea is being communicated? The crazy and interesting concept drives every technical decision.

In the capture pipeline, each beat includes:

### Concept

What does this scene REPRESENT in terms of previous (if exists) and next scenes? Not "show features" but a specific idea and logic.

### VO cue

Which narration line plays over this beat (Also keep in mind the whole narration of the video to understand and keep in mind the flow).

### Visual description

What the viewer sees — described cinematically, not as CSS specs. Use camera language and production motion designer vocabulary (pan, zoom, drift, settle, and more of those words). Think in layers — what's supposed to happen in the foreground, midground, background simultaneously?

**For beats using captured screenshots:** specify which screenshot, how much of the frame it fills (%), and where text/labels go relative to the screenshot's safe zones (if there are any at all lol). Don't blindly center text over busy product UI or even on sides if it has something there.

### Assets

Every asset used in this beat — exact path from project root, exact usage intent. No vague references. Name the actual file from the capture and describe precisely how it's used.

Format (these are FORMAT EXAMPLES showing how to write it, not actual files to use):

- `capture/assets/<actual-filename>` — [what it is and exactly how it appears: fill %, motion, treatment, opacity, positioning]
- `capture/assets/svgs/<actual-filename>` — [what it is and exactly how it enters and behaves]

Write this section for the real captured files from THIS project's asset audit above, not from memory.

### Text Animations

Every text element in this beat must name a specific effect from `skills/hyperframes/references/text-effects.md`. Read the catalog, pick what fits the brand and this beat's mood — don't default to the same effect every beat.

Format (FORMAT EXAMPLES of structure, not prescriptions — pick based on brand/mood/context):

- `[element — e.g. "main headline"]`: `[effect-id]` — `skills/hyperframes/assets/text-effects/effects/[id].json`
- `[element — e.g. "eyebrow label"]`: `[effect-id]` — `skills/hyperframes/assets/text-effects/effects/[id].json`

The sub-agent reads the named JSON file and implements from `showcase.library_adapters.gsap`. No creative decisions at build time.

### Beat Timing

Two numbers Step 5 needs to wire `data-start` and `data-duration` correctly:

- **HyperShader transition in at:** `[time]s` (the `time:` value in the transitions array for the transition INTO this beat — or 0 for beat 1)
- **GSAP timeline duration:** `[duration]s` (how long this beat's internal animations run — when does the last tween end?)

Example: `Transition in at: 4.2s · GSAP duration: 5.5s` → Step 5 sets `data-start="4.2" data-duration="5.5"`.

### Animation Sequence

Millisecond-level choreography for everything in this beat. The sub-agent executes this — it doesn't invent it. Every entrance, hold, camera move, layer event, and exit with a timestamp.

If you know exact GSAP values — write them. If you don't, describe the feel and behavior specifically enough that the sub-agent can derive the right values: "snappy overshoot bounce settling into place" tells the sub-agent to use back.out; "slow heavy drift" tells it to use power1.inOut with a longer duration. Vague adjectives are useless — describe what the motion physically does and how it feels.

FORMAT EXAMPLE of structure (write the real choreography for THIS beat):

- `0.0s`: [what appears or starts, and how it feels/behaves]
- `0.Xs`: [next event — either exact values or precise behavioral description]
- `[beat-end - 0.4s]`: [exit / transition fires]

---

## Production Architecture

Include this file tree at the bottom of the storyboard:

```
project/
├── index.html                    root — VO + underscore + beat orchestration
├── DESIGN.md                     brand reference (from Step 1)
├── SCRIPT.md                     narration text (from Step 3)
├── STORYBOARD.md                 THIS FILE — creative north star
├── transcript.json               word-level timestamps (from Step 4)
├── narration.wav                 TTS audio (from Step 4)
├── capture/                      captured website data (from Step 0)
│   ├── screenshots/
│   ├── assets/
│   │   ├── svgs/
│   │   ├── fonts/
│   │   ├── lottie/
│   │   └── videos/
│   ├── extracted/
│   │   ├── tokens.json
│   │   ├── design-styles.json
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

The two beats below are from the real Claude Design × HyperFrames production video. They show the expected level of specificity — exact timing, exact GSAP values, exact animation sequences.

**Why only 2 beats are shown:** Earlier versions of this reference showed all 10 beats, and agents pattern-matched from them regardless of the brand being captured. Moodboard layouts, capabilities grids, and orbital letter closers started appearing in every video. The concepts in those beats are specific to HyperFrames as a product — they should not appear in a video about a fintech tool or a wellness app. Only two beats are shown here to demonstrate the format level, not to suggest these specific techniques.

### BEAT 1 — LIGHT BALL OPENER (0:00–0:03)

**Concept:** No title card, no fade from black. A single point of warm light appears in total darkness. It blooms into a horizon-spanning glow. The viewer leans in before a single word is spoken.

**Visual:** Deep black canvas (#050507) with grain overlay (mix-blend-mode: overlay, 0.12 opacity) and extended vignette (inset: -200px for long falloff). The `.ball-core` is a 40px radial-gradient orb (white center → accent → transparent). Animation sequence:

- 0.0s: Orb appears tiny (scale: 0.15, opacity: 0→1, 0.18s, expo.out)
- 0.18s: Orb grows continuously (scale: 0.4→1.4, 0.7s, power1.in). Simultaneously the `.ball-halo` (140% width, 70% height ellipse, accent-tinted radial-gradient, blur: 60px) blooms in (scale: 0.4→1, opacity: 0→1, 0.55s, sine.out)
- 0.65s: Orb keeps growing as it fades (scale: 1.4→8, opacity: 1→0, 0.4s, power2.in) — the point of light dissolves into pure glow. Halo expands further (scale: 1→1.25, opacity: 0.85)
- 0.85s: Horizontal beam line emerges from center (scaleX: 0→1, 0.4s, expo.out) with warm box-shadow glow (0 0 24px 1px rgba(255,240,220,0.4))
- 1.0s: Title "Claude Design × HyperFrames" fades up above the line (opacity: 0→1, y: 14→0, 0.7s, power3.out). Ampersand in italic accent color.
- 1.3s: Date subtitle appears below the line (0.6s, power2.out). Monospace font, 0.32em letter-spacing, uppercase.
- 2.2s: Bottom credit line fades in ("This entire video was made with HyperFrames in Claude Design")
- 3.0–4.4s: Hold — halo breathes (opacity drifts to 0.55, scale to 1.4, sine.inOut), headline drifts slightly (y: -3px)
- 4.4s: Everything fades to black together (0.6s, power2.in)

Corner marks (monospace, 11px, 0.45 opacity) at top-left and bottom-right for editorial feel.

**SFX:** Deep ambient bass pad already playing from frame 1.

---

_(Beats 2–9 intentionally omitted. See above for why.)_

### BEAT 10 — ORBITAL LETTERS / CLOSE (example of a closing beat spec)

**VO:** (resolving — the brand name assembles)

**Concept:** Individual letterforms of "HYPER FRAMES" burst in from alternating sides, each with rotation and offset. They bounce into place with back.out(2.0) overshoot. An accent line draws itself across the width. An orbit ring expands with a glowing dot tracing a full 360° rotation. A tagline types itself out: "HTML in. Video out." with deliberate pauses after each word. Everything breathes after assembly — letters float gently, glow pulses, connector lines shimmer.

**Visual:** Deep black. Center glow: 900px radial-gradient orb (accent #e8a769 at 0.35 → 0.12 → 0.025 → transparent), blur(100px).

**Animation sequence:**

- 0.1s: 12 character elements ("H Y P E R [space] F R A M E S") enter staggered 0.06s apart, each from y: 80 with alternating x offset (odd: -30, even: +30) and rotation: -15. Landing: back.out(2.0), 0.7s — gives each letter a satisfying overshoot bounce.
- 1.0s: Accent SVG line draws across the full 1920px width (strokeDashoffset: 1920→0, 0.6s, power3.out). #e8a769 stroke, 2px.
- 1.0s: Glow breathes in (opacity: 0→0.2, sine.inOut, 0.4s), then back to 0.1.
- 1.4s: Orbit ring (600px circle, 1px border rgba(accent, 0.3)) expands from scale: 0.5 to 1.0 (expo.out, 0.5s). A glowing orbit dot (8px, accent color, box-shadow glow) on the ring traces a full 360° rotation over 2.5s (linear easing — constant speed).
- 1.25s onward: Letters begin a subtle float — alternating directions (y: ±2px, sine.inOut, 1.4s, yoyo, repeat 1), staggered 0.04s. Keeps the assembled word feeling alive.
- 1.8s: Tagline types itself in monospace (24px, accent color, 0.15em letter-spacing): "HTML" (pause 0.2s), " in." (pause 0.25s), " Video" (pause 0.1s), " out." — each segment at 0.03s per character using steps(N) easing for discrete character appearance.
- 1.8s onward: Glow continues gentle breathing (opacity: 0.1→0.14, sine.inOut, 1.2s, yoyo, repeat 1).

**SFX:** Soft chime on letter assembly completion. Silence under the tagline typing — let it land.

---

## Write the Narration Script (same step — write alongside the storyboard)

The script and storyboard are one step. Every beat already has a VO cue — the script is just all those VO cues assembled into a single document. As you write each beat, write its narration line. Then assemble them into `SCRIPT.md`.

The script serves the storyboard — write words that fit the visual plan, not the other way around. Reference real product features, real stats, and real components from `capture/extracted/visible-text.txt`. Use exact numbers.

**Script length depends on the creative direction, not a formula.** A cinematic video with dramatic pauses and visual-only moments might have 40 words across 30 seconds. A rapid feature showcase might pack 100 words into 30 seconds. The storyboard's pacing and style (from Step 2's Creative Brief) determine how much narration vs. silence the video needs. Some beats are narrated; some are pure visual. Let the creative plan drive the word count, not the other way around.

The key constraint: don't pad with dead silence where nothing is happening. If a beat has no narration, something visual must be carrying the viewer's attention. Empty frames = lost viewers.

Save as `SCRIPT.md` in the project directory.

**Script writing rules:**

- ~2.5 words/sec natural pace. 15s = ~37 words, 30s = ~75 words.
- Use contractions ("it's", "you'll"). Read it out loud — if it sounds robotic, rewrite.
- Write numbers as spoken: `$1.9T` → "nearly two trillion dollars", `API` → "A P I", `10x` → "ten times"
- **Hook first** — bold claim, provocative question, contrast, or shocking number. Never "Welcome to..." or "Introducing..."
- Structure: Hook → Story → Proof → CTA. 15s ads can skip Story.

---

## User Review Gate

After writing the storyboard AND the script, present BOTH to the user for review. The storyboard and script are coupled — the user needs to see them together to judge whether the video works.

### How to Present

Summarize the plan clearly. Don't dump the full STORYBOARD.md — give the user a beat-by-beat overview they can scan in 30 seconds:

> **Here's what I've planned for your [duration] [type]:**
>
> **Beat 1 (0:00–0:04):** [one sentence — what happens visually + what the narration says]
> **Beat 2 (0:04–0:10):** [one sentence]
> **Beat 3 (0:10–0:18):** [one sentence] _(hero beat — 3D MacBook reveal with bloom effect)_
> ...
> **Beat N (closing):** [one sentence — CTA/logo]
>
> **Style:** [dimension summary — e.g., "Cinematic pacing, dark mood, dramatic transitions for hero, clean for the rest"]
> **Narration:** [first and last line of the script]
> **Total duration:** [X]s with [N] beats
>
> **Does this match what you envisioned?** I can adjust: beats, pacing, specific effects, the script tone, or anything else. Or if this looks good, I'll proceed to voice generation.

### What to do with feedback

- **"Looks good" / approval** → proceed to Step 4 (VO)
- **Specific feedback** ("make beat 3 longer", "change the opening to be faster", "I don't want the typing effect") → update STORYBOARD.md and SCRIPT.md, re-present
- **Major direction change** ("actually I want it more playful, not cinematic") → revisit the creative brief dimensions, rewrite storyboard
- **Iterate until the user is satisfied.** This is the cheapest place to make changes — changing a storyboard beat costs 30 seconds. Changing a built composition costs 5 minutes.

### Gate

Both STORYBOARD.md and SCRIPT.md exist AND the user has explicitly approved the plan.
