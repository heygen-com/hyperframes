# Step 3: Storyboard + Script

Marketing videos are made concept-first. **The order is: message → narrative arc → beats that serve the arc → which assets and techniques bring each beat to life.** Captured assets (SVG logos, brand illustrations, hero art, gradients) are first-class beat content alongside composed beats — many of them will carry their own beats. The constraint is only that you shouldn't _start_ from the asset inventory ("we have these screenshots, let's build a slideshow"). Start from the message, then weave in the right captured assets and the right composed elements per beat.

**Read `capture/extracted/asset-descriptions.md` before writing beats.** Know what's in the capture. The brand's actual visual identity — its real logo, its real illustrations, its real gradients, its real hero art — is what makes the video feel like _this_ brand and not a generic dark cinematic template. Most beats will use one or two captured assets layered with composed motion.

## First decision: CONCEPT

Before pacing, before beats, before anything else — write the concept block at the top of `STORYBOARD.md`. Carry forward what was decided in Step 2's brief:

```markdown
**Message:** [the ONE thing this video must communicate — one sentence]
**Arc:** [Problem→Solution / Reveal / Demonstration / Vibe / Comparison — and a one-sentence shape of how it unfolds]
**Audience:** [who's watching, where they're watching — TikTok scrollers, LinkedIn viewers, embedded on landing page]
**Brand voice:** [confident / playful / clinical / urgent / premium — pulled from DESIGN.md]
**Why this matters now:** [GTM context if relevant — launch, feature ship, brand reposition, ongoing demo]
```

If any of those rows are blank, the storyboard cannot land. Go back to the brief — don't substitute "show the kanban" for a message.

**The single-sentence test:** _"What makes this video different from a generic [video type] for any [industry] brand?"_ If you can't answer it from the rows above, the concept isn't sharp enough. Sharpen it before writing pacing or beats.

---

## Second decision: PACING

With the concept locked, pick the pacing that serves it. This determines beat count, beat duration, and architecture — every downstream choice flows from here.

Read the message and arc from the concept block above plus the style direction from Step 2's brief. Map to one of these:

| User says                                                   | Pacing       | Beat count | Beat duration | Architecture                                               |
| ----------------------------------------------------------- | ------------ | ---------- | ------------- | ---------------------------------------------------------- |
| "fast", "punchy", "rapid cuts", "energetic", "social ad"    | **Fast**     | 8–15       | 0.7–1.8s      | Single-file stacked beats, hard cuts                       |
| "demo", "walkthrough", "product tour", "show features"      | **Moderate** | 4–6        | 3–5s          | Sub-compositions, CSS crossfades                           |
| "cinematic", "premium", "slow", "let it breathe", "elegant" | **Slow**     | 3–4        | 5–8s          | Sub-compositions, long crossfades                          |
| "launch", "announcement", "story", "narrative"              | **Arc**      | 5–7        | varies        | Slow opener → building middle → fast peak → resolved close |

**Write your pacing choice at the top of STORYBOARD.md.** Example: `**Pacing: Fast** — 12 beats, stacked divs, hard cuts.`

If the user said "dark cinematic feel" — that's SLOW, not fast. If they said "rapid cuts, bold typography" — that's FAST. Don't default to moderate when the prompt gives you a clear signal.

---

## Technique-pick checklist (REQUIRED, do this BEFORE writing beat copy)

For every beat you plan, name **2–4 techniques** it will use. A beat with one technique is a slideshow frame — if you can't name two, redesign that beat.

Pick from the inventory in [capabilities.md](capabilities.md) and implementation patterns in [techniques.md](../../hyperframes/references/techniques.md). Examples of composable beats:

```
Beat 3: composed kanban (4 cards-as-divs per column) + counter chip on In-Progress + back.out entrance stagger
  techniques: layered panels (capabilities §1), counter via tl.set (techniques #15),
              GSAP stagger with back.out(1.7) (techniques #4)
  customize:  real project name "Atlas Q3", brand purple #5b3fff, realistic backlog items
```

**Customize is the actual deliverable** — what makes this beat THIS brand's beat. Brand colors, real content, narration-sync timing. Generic "show the kanban" with no concrete techniques, no customize plan, no brand-specific data = lazy thinking. Beats must be invented from this brand's identity, not assembled from generic UI shapes.

---

**Re-read these files before writing:**

- **DESIGN.md** — your color palette, font rules, components, Do's/Don'ts. Every visual must be grounded in this brand identity. If it says "white backgrounds with purple accent" — plan light scenes, not dark moody ones.
- **Asset discovery — view the contact sheets carefully, every cell.** Open `capture/assets/contact-sheet-*.jpg` and `capture/assets/svgs/contact-sheet-*.jpg`. Both are paginated — view every page (`contact-sheet-1.jpg`, `contact-sheet-2.jpg`, etc.). **For each page, name 5 specific assets you can see before moving on.** Past agents have reported "viewed the contact sheet" after one glance and then wrote beats referencing assets that didn't exist or missed the brand logo entirely. Don't be that agent. When you find an asset that earns its place in a beat, note the filename from the label and reference it as `capture/assets/<filename>`. If a thumbnail is too small to judge resolution / fine detail, open the individual file. Also read `capture/extracted/asset-descriptions.md` for one-line summaries. **Never use contact sheets or scroll screenshots in the video itself** — contact sheets have grid labels baked in; scroll screenshots are raw browser captures. Both are for AI to BROWSE and understand the site, not to place in compositions.
- **[techniques.md](../../hyperframes/references/techniques.md)** — 13 primitive animation techniques with code patterns. Pick for beats, these are starting points to adapt, not templates to copy.
- **[text-effects.md](../../hyperframes/references/text-effects.md)** — 24 named text animation effects from the separate `pixel-point/animate-text` skill. The reference page tells you how to load the upstream skill; the IDs are listed inline. Assign a specific effect ID to every headline, label, and copy element in every beat — not generic "fades in" descriptions.

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

- Captured assets are accents on composed beats, not the beats themselves — see Asset Audit below for which assets earn a place (typically 2-4 across the whole video).
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

**Shader transitions — block name ≠ shader name.** Registry showcase blocks are standalone demos, not the reusable HyperShader runtime, and their HTML may implement the effect directly without calling `HyperShader.init()`. Use the canonical block-to-shader mapping in `skills/hyperframes-registry/references/discovery.md` when writing the storyboard. For example, the `domain-warp-dissolve` block maps to the `domain-warp` runtime name. Installing a showcase is optional visual reference only; if you install one, remove its composition afterward so it does not create unrelated lint warnings.

## Asset Audit — REQUIRED before writing beats (non-skippable)

The skill's #1 purpose is to USE the brand's captured assets — not rebuild them from CSS. Most of your beats should feature at least one captured asset: a hero illustration, a signature SVG, product photography, brand mark, distinctive graphic. **If your STORYBOARD.md ends with only the logo used, you have failed this step.**

**Why this gate exists:** Earlier sessions wrote their own "Asset Audit" that said SKIP for 60+ of 65 captured assets, used only the logo, and shipped a video that visually was indistinguishable from a generic dark-mode SaaS launch. The captured MetaBrain illustration, the GitHub-sync diagram, the knowledge-base hero — all left on the floor. The signature visuals that make a brand recognizable were absent. Don't repeat that.

**Required pre-storyboard procedure:**

1. **View every page of `capture/assets/contact-sheet-*.jpg`** AND every page of `capture/assets/svgs/contact-sheet-*.jpg`. These are the sheets generated by capture for this exact purpose. Open each page; scan cell-by-cell. Do not skim — you are looking for the brand's visual identity, frame by frame.

2. **For each contact sheet page, paste this block into STORYBOARD.md under an "Asset Audit" section:**

```
Contact sheet: capture/assets/contact-sheet-1.jpg (page 1 of N)
  5 most visually distinctive assets I see (filename + one-sentence description of what the image shows):
  1. <filename>: <what's actually pictured — not the filename, the content>
  2. <filename>: <description>
  3. <filename>: <description>
  4. <filename>: <description>
  5. <filename>: <description>
```

Repeat for every contact sheet page. The number of pages × 5 is your candidate asset pool.

3. **For each beat in STORYBOARD.md**, choose USE or SKIP for each candidate asset:
   - **USE** means the asset appears in the beat's HTML at build time (`<img src=...>`, inline SVG, `background-image: url(...)`).
   - **SKIP** requires a one-sentence reason explaining why this asset doesn't serve this beat. "Doesn't fit storyboard" is not a reason — name which storyboard moment failed to find a use for it.

4. **Brand-defaults floor:** at least ONE beat must use the brand's signature visual (hero illustration, hero photograph, or signature diagram — not the logo). If you've named 5+ candidate hero illustrations in step 2 above and zero of them appear in any beat, that is the failure mode this gate exists to catch.

**Forbidden:**

- Writing "SKIP" for every asset except the logo without per-asset justification
- Reading `capture/extracted/asset-descriptions.md` (the text file) and making decisions from filenames alone, without opening the contact sheets
- Concluding "I'll rebuild the GitHub-sync diagram in CSS" when the brand's own SVG of that diagram is sitting in `capture/assets/`. Use the real asset.

If your final beat list uses less than ~30% of relevant captured assets (relevant = anything except the favicon and tiny UI icons), revisit. The brand is visually carried by its own art; rebuilding it from divs erases what makes it recognizable.

### HTML-in-Canvas — plan for it here, build in Step 5

The `drawElementImage` Chrome API captures any live HTML/CSS as a GPU-accelerated texture at 60fps. This is HyperFrames' highest-impact capability — it lets you render captured product screenshots or UI through:

- **3D geometry** — a rotating iPhone or laptop model, a sphere, a curved surface
- **WebGL shaders** — liquid glass refraction, shatter into fragments, portal reveal, noise distortion
- **Post-processing** — bloom, depth-of-field, film grain, color grading

When planning beats, decide which ones deserve an HTML-in-Canvas treatment vs. a standard GSAP animation. If you want it, name it in the storyboard — Step 5 will read [`../../hyperframes/references/html-in-canvas-patterns.md`](../../hyperframes/references/html-in-canvas-patterns.md) for implementation. You don't need to specify the API details here.

### SFX assignment — happens here, not in Step 5

**Before writing beats,** read the SFX manifest. Locate it from your current directory:

```bash
find "$HOME" -path '*/website-to-video/assets/sfx/manifest.json' -maxdepth 10 2>/dev/null | head -1
```

Or if you already copied SFX into the project (Step 5 does this), read your local `sfx/manifest.json`. Each entry has a filename, duration in seconds, and description. Assign **specific SFX files** to exact moments in the storyboard. Step 5 implements what you specify here — it makes no SFX decisions.

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

## Per-Beat Direction

Each beat is a SHOT, not a layout. Write what the CAMERA does and what the FRAME reveals — not "what's positioned where on the page."

### A beat is a shot — pick the framing before writing CSS

Every beat header should declare its shot type in the first line. **Shot types:**

| Shot                  | Use for                                                                                  | What the frame contains                                               |
| --------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Extreme close-up**  | a single card / number / character / cursor / button as the entire subject               | one element fills 60–90% of frame, everything else blurred or absent  |
| **Close-up**          | a small UI region (a single column, a card stack, a chart, a code block)                 | the subject fills 40–60% of frame with depth-layered context behind   |
| **Medium**            | a section of UI — kanban with 3 columns, chat with 3 messages, dashboard with 2-3 panels | the subject fills 60–80% of frame, edges of nearby UI bleed in        |
| **Wide**              | full UI assembly visible — only when the WHOLE thing is the point                        | full UI at 70–90% scale with deliberate negative space                |
| **Over-the-shoulder** | viewer "behind" the user — cursor / hands / device foreground, UI midground              | foreground element bottom 1/3, UI fills upper 2/3 with parallax depth |
| **Dutch angle**       | tension, urgency, "something's off"                                                      | the frame is tilted 4–8°, content composed to feel unstable           |

**The "wide shot" trap:** _Every_ beat at wide framing looks like a screenshot in CSS. Most product-demo videos should be 60% close-up + close-up + 20% medium + 10% wide + 10% extreme close-up. Wide is the rare establishing shot, not the default.

### Camera motion is the subject, not the elements

In website thinking: elements animate in, then sit still while the user reads. In video thinking: the camera moves THROUGH the scene. The composition shifts.

Every beat needs at least one camera-style move. Pick from:

- **Dolly in** — composition scales 1.0 → 1.08 over the beat duration, slight x/y drift
- **Dolly out / pull-back** — composition scales 1.15 → 1.0, revealing more context
- **Push** — fast scale-up (1.0 → 1.05, ~0.5s power3.out) on a key moment
- **Parallax pan** — background drifts opposite to foreground at different speeds
- **Orbit** — the subject rotates in 3D, or the camera circles it
- **Rack focus** — blur shifts from one element to another (background blurs as foreground sharpens)

If a beat has NO camera-style move and elements only animate inward at the start, it will read as a webpage with entrance animations. That's not a video beat.

### Forbidden patterns (the video-as-webpage failures)

These appear in nearly every iteration where sub-agents revert to website thinking. Refuse to write any beat that includes:

- ❌ **macOS / browser window chrome** as a frame around the content — traffic-light dots, URL bars, browser tabs, breadcrumbs — UNLESS the beat IS specifically about that chrome (e.g., "the macOS window itself is the subject of the shot")
- ❌ **Sidebars, navigation rails, page headers, page footers** unless the beat demonstrates navigation as its concept
- ❌ **"Centered card / panel / window with 60–120px margin on all sides"** — that's the standard webpage layout; videos use the full frame and meaningful negative space
- ❌ **"Hold with breathing" micro-animations** where elements move y: ±1–2px or scale 1.01 — invisible at video resolution; this is sub-agents pretending the beat has motion when it doesn't
- ❌ **Settled holds longer than 1.5s** with no continuous camera or compositional change — fix by adding camera dolly, depth-layer parallax, or new sub-elements entering mid-beat
- ❌ **Hover-state demonstrations** — videos have no hover; if the brand has a hover effect to communicate, find a way to show the BEFORE and AFTER as discrete frames, not a hover simulation
- ❌ **Tooltips and modal cards "for context"** that explain what something is — videos communicate through visual language, not popup hint text

### Required for every beat (the floor for video grammar)

Every beat must specify, in its visual description:

1. **Shot type** (one of the six above)
2. **Camera move** (which one, when it starts, how long it lasts)
3. **Depth strategy** (what's in foreground / midground / background, how they parallax)
4. **Motion magnitudes** that read at video scale (30px+ y/x movements, scale changes ≥0.05, opacity transitions ≥0.5)
5. **The shot's purpose** — what specifically is the viewer supposed to feel or notice in this 3–5 seconds?

---

### Existing beat-level fields (below) layer on top of the shot grammar above

Each beat is a WORLD, not a layout. Write what the viewer EXPERIENCES before you write CSS specs.

**Motion verbs** — every animated element gets one. Pick from the beat's concept, not from an energy bucket:

- **Impact:** SLAMS, CRASHES, PUNCHES, DROPS, SHATTERS
- **Directional:** SLIDES, PUSHES, WIPES, CUTS
- **Reveals:** DRAWS, FILLS, GROWS, ASSEMBLES, COUNTS UP
- **Organic:** FLOATS, DRIFTS, BREATHES, PULSES, ORBITS
- **Mechanical:** TYPES ON, CLICKS, LOCKS IN, SNAPS, STEPS

**Transition decision matrix** — shader vs CSS vs hard cut:

| Shader transition for                     | CSS crossfade for                                 | Hard cut for                                      |
| ----------------------------------------- | ------------------------------------------------- | ------------------------------------------------- |
| Hero reveals, logo unveils, "wow" moments | Continuous motion between beats, editorial pacing | Rapid-fire lists, percussive edits, comedy timing |

1–2 shader transitions per video (hero + CTA). Too many flatten their impact. Mix shader and CSS crossfade in one HyperShader composition by omitting `shader` on any transition entry.

**Rhythm** — declare your scene rhythm before implementing: fast-fast-SLOW-fast-SHADER-hold. The rhythm comes from the brand and content, not a template.

Use the pacing you decided at the top of this step. The beat count, duration, and architecture are already set.

**Cut the video to match the narration length** — if the script produces 22 seconds of audio, the video should be 24 seconds with a 2-second CTA hold, not 30 seconds with 8 seconds of dead silence. Empty time at the end where nothing is happening loses the viewer.

**Frame-filling rule:** When describing visuals per beat, specify sizes as FRAME FILL PERCENTAGES, not pixels. "Product screenshot fills 80% of frame" not "600px wide card."

**Use whatever primitives the beat needs — alone or in combination.** A beat can layer HTML/CSS, SVG (captured or hand-drawn), WebGL/Canvas shaders, Three.js scenes, captured illustrations and photographs, kinetic typography, captured Lottie — all at once if the scene calls for that. They're inputs to one output (the video frame); there's no rule mapping intent to primitive. The video should feel **alive in every frame** — motion that's continuous and tangible, **like things exist in a physical world**. Narrow no-go: never paste a product-UI screenshot as load-bearing content (the slideshow pattern). Everything else is open.

**Opener default: fast intro to stop the scrollers.** Even a cinematic video should start with a punch — a flash, a shader bloom, a logo strike, a kinetic word build, a particle burst — anything that lands inside the first 1.0–1.5 seconds. Slow intros work for prestige trailers; videos shipping anywhere social or feed-based need a hook that beats the 1.5-second scroll threshold. Plan the opener as the most ambitious beat in the storyboard, not the gentlest one.

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

**When a captured asset is the primary visual** (logo opener / closer, hero illustration with parallax, hero photograph with motion treatment, gradient as full-bleed background, etc.): specify which asset, how much of the frame it fills (%), and where text/labels go relative to its safe zones. Don't blindly center text over busy product UI. The narrow no-go: never paste a product-UI screenshot as full-bleed beat content — that's the slideshow pattern this workflow exists to break. Captured logos, illustrations, hero art, and photography are fine as primary visuals when the concept calls for them.

### Composition + Accents

Two things, both required:

**Composed (load-bearing — what carries the beat):**

- Describe the UI / element / scene you're building from scratch: markup structure, the techniques powering it (cite [capabilities.md](capabilities.md) sections + [techniques.md](../../hyperframes/references/techniques.md) entries), key animation events. E.g. "Composed kanban: 3 column divs, 4 cards each, drag-and-drop with `back.out(1.7)` entrance stagger, counter chip on In-Progress incrementing via `tl.set()`."
- **Brand-inflect:** brand colors from DESIGN.md, real product data (project names, real metrics, real copy — not placeholder labels), narration-sync moments. Make this beat THIS brand's beat, not a generic UI demo.

**Accents (decoration only — what brand-inflects the beat):**

- Optional. Most beats need 0-1 accent. Format: `capture/assets/<filename>` — how it appears: position, opacity, treatment, motion (e.g. `capture/assets/logo.svg` — top-left, 60×60, fades in at 0.4s, breathes during hold).
- Common accent uses (when the primary visual is something else): brand logo stamped on a UI beat, hero illustration as a depth layer behind kinetic type, gradient image as ambient background wash. When the captured asset IS the primary visual (logo drawing itself on the opener, hero illustration with parallax as a hero beat), it isn't an accent — it's the beat content; document it under Composition, not here.
- If a beat has no obvious accent need, leave this blank. The primary visual is enough.

Write this section for THIS project's actual brand and the assets audited above — not from memory.

### Text Animations

Every text element in this beat must name a specific effect from the catalog. The reference page is at [`../../hyperframes/references/text-effects.md`](../../hyperframes/references/text-effects.md) (or locate it with `find "$HOME" -path '*/hyperframes/references/text-effects.md' -maxdepth 10 2>/dev/null | head -1`). It lists 24 effect IDs (from the separate `pixel-point/animate-text` skill); pick what fits the brand and this beat's mood — don't default to the same effect every beat.

Format (FORMAT EXAMPLES of structure, not prescriptions — pick based on brand/mood/context):

- `[element — e.g. "main headline"]`: `[effect-id]`
- `[element — e.g. "eyebrow label"]`: `[effect-id]`

At build time, the sub-agent loads `/animate-text` (the upstream skill) and reads each named effect's spec from `.agents/skills/animate-text/assets/effects/<id>.json`. No creative decisions at build time — just spec retrieval and implementation.

### Beat Timing

Two numbers Step 5 needs to wire `data-start` and `data-duration` correctly:

- **HyperShader transition in at:** `[time]s` (the `time:` value in the transitions array for the transition INTO this beat — or 0 for beat 1)
- **GSAP timeline duration:** `[duration]s` (how long this beat's internal animations run — when does the last tween end?)

Example: `Transition in at: 4.2s · GSAP duration: 5.5s` → Step 5 sets `data-start="4.2" data-duration="5.5"`.

### Animation Sequence — must span the ENTIRE beat

A beat is a SCENE with internal life, not a single entrance followed by a static hold. Things should be happening throughout the entire duration — new elements appearing, existing elements transforming, camera drifting, details revealing, sub-moments unfolding.

If your animation sequence only has events in the first 2 seconds and the beat lasts longer, the rest is dead air. Plan moments across the full duration. Nothing should sit unchanged for more than ~2 seconds — if an element is on screen, give it continuous motion (drift, breathe, pulse, parallax).

Describe the feel precisely: "snappy overshoot bounce settling into place" → back.out; "slow heavy drift" → power1.inOut. Vague adjectives are useless.

---

## Brand Accents Pass (LAST creative decision — happens after beats are written)

Your beats are now conceptually defined. Each one has a primary visual that carries it (composed UI, captured asset, kinetic typography, WebGL, etc.). **Now**, do a single pass to decide which captured assets — if any — earn an accent role on the beats where another primitive carries the visual.

This is the LAST creative pass before file-tree time. It comes here intentionally: assets serve concept-defined beats — as primary visual or as accent, depending on what each beat needs — but they don't seed beats. If you find yourself wanting to add a beat _because_ an asset would look cool, the asset is doing the storyboarding — go back and rewrite that beat from the message instead.

### Brand defaults (nice-to-haves for most brand videos)

Two defaults that work for most brand-focused videos. Skip them when the concept calls for it; they're not hard requirements.

1. **The brand mark in opener + closer.** For most brand videos, the logo / wordmark SVG lands in the opener (as the entry tag) and the closer (as the sign-off). It gives the viewer the brand at both ends of the watch. Skip when the concept calls for it — e.g., a teaser that deliberately delays the brand reveal until beat 3 for narrative tension, or a video where the brand mark would feel redundant against the captured hero art.

2. **The site's signature visual somewhere in the video.** Every captured site has one: a gradient wave, a hero illustration, a distinctive product UI mark, the wordmark animation, a color combination, a hero photograph. It's whatever a viewer who knows the brand would point at and say "that's them." Find it during Step 0; place it where the concept can use it. Not required — but if a brand video doesn't include this, ask whether the video still feels like _this_ brand.

These are defaults, not requirements. Beyond them, aim for 2-4 brand accents total across the whole video, not per beat. Most beats need 0-1. Everything beyond the floor has to justify itself against the question: _"Does this asset make the beat MORE this brand, or is it filler?"_

Print this table once your beats are written:

| Asset                          | Type     | Where (beat #)  | Role                                                                            |
| ------------------------------ | -------- | --------------- | ------------------------------------------------------------------------------- |
| stripe-logo.svg                | SVG      | Beat 1 + Beat N | Brand mark (opener stroke-draw, closer hold)                                    |
| wave-fallback-desktop.png      | Gradient | Beat 3 bg layer | Ambient depth wash behind composed dashboard                                    |
| datavizstatic3x.png            | Data viz | SKIP            | Compose the stats from divs + counter animations instead                        |
| enterprise-accordion-hertz.png | Photo    | SKIP            | Compose the customer-story UI from divs with the brand's testimonial card style |
| icon-3.svg                     | Icon     | SKIP            | Decorative, too small to matter                                                 |

Mark assets `SKIP` when a composed equivalent (dashboards, kanban, chat, terminal, file tree, calendar, pricing cards, etc.) does a better job — that's the strong default for product UI. Use the brand's _real_ data (project names, real metrics, real product copy) in composed beats — never the placeholder labels a screenshot would have.

**Update each beat's Composition + Accents section** based on what this pass produced. Most beats stay accent-free. The few that earn one get a single line under "Accents" with the file, position, opacity, and motion.

**The bar:** Every beat's visuals use whatever combination of primitives the scene needs. Accents are optional brand inflections layered on top; the brand-defaults section above (logo in opener + closer, signature visual once) covers most brand videos but isn't a hard requirement.

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

**Script length depends on the creative direction, not a formula.** A cinematic video with dramatic pauses and visual-only moments might have 40 words across 30 seconds. A rapid feature showcase might pack 100 words into 30 seconds. The storyboard's pacing and style (from Step 2's brief) determine how much narration vs. silence the video needs. Some beats are narrated; some are pure visual. Let the creative plan drive the word count, not the other way around.

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

Summarize the plan clearly. Don't dump the full STORYBOARD.md — give the user a beat-by-beat overview they can scan in 30 seconds. Per `../../hyperframes-creative/references/story-spine.md` § 3, the summary is a proposal: open by echoing the strategy line, and give every beat a `why:` traced to the message:

> **This video tells [audience] that [message].** Here's the plan for your [duration] [type]:
>
> | Beat          | On screen + narration                                              | Why                                     |
> | ------------- | ------------------------------------------------------------------ | --------------------------------------- |
> | 1 (0:00–0:04) | [one sentence — what happens visually + what the narration says]   | [the beat's job, traced to the message] |
> | 2 (0:04–0:10) | [one sentence]                                                     | […]                                     |
> | 3 (0:10–0:18) | [one sentence] _(hero beat — 3D MacBook reveal with bloom effect)_ | […]                                     |
> | …             | …                                                                  | …                                       |
> | N (closing)   | [one sentence — CTA/logo]                                          | […]                                     |
>
> **Style:** [dimension summary — e.g., "Cinematic pacing, dark mood, dramatic transitions for hero, clean for the rest"]
> **Narration:** [first and last line of the script]
> **Total duration:** [X]s with [N] beats
>
> **Does this match what you envisioned?** I can adjust: beats, pacing, specific effects, the script tone, or anything else. Or if this looks good, I'll proceed to voice generation.

### What to do with feedback

- **"Looks good" / approval** → proceed to Step 4 (VO)
- **Specific feedback** ("make beat 3 longer", "change the opening to be faster", "I don't want the typing effect") → update STORYBOARD.md and SCRIPT.md, re-present
- **Major direction change** ("actually I want it more playful, not cinematic") → revisit Step 2's brief dimensions, rewrite storyboard
- **Iterate until the user is satisfied.** This is the cheapest place to make changes — changing a storyboard beat costs 30 seconds. Changing a built composition costs 5 minutes.

### Gate

Both STORYBOARD.md and SCRIPT.md exist AND the user has explicitly approved the plan.

**Autonomous mode exception:** if the user signaled autonomous mode in Step 2 ("surprise me" / "decide for me" / "just build it"), skip the approval wait. Present the storyboard summary inline as a heads-up and proceed straight to Step 4.
