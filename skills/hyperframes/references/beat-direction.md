# Beat Direction

How to plan and direct individual scenes (beats) in a multi-scene composition. Read before writing any multi-scene video.

---

## Per-Beat Direction

Each beat is a WORLD, not a layout. Before writing CSS specs and GSAP instructions, describe what the viewer EXPERIENCES. The difference between a great storyboard and a mediocre one:

**Mediocre:** "Dark navy background. '$1.9T' in white, 280px. Logo top-left. Wave image bottom-right."
**Great:** "Camera is already mid-flight over a vast dark canvas. The gradient wave sweeps across the frame like aurora borealis — alive, shifting. '$1.9T' SLAMS into existence with such force the wave ripples in response. This isn't a slide — it's a moment."

The first describes pixels. The second describes an experience. Write the second, then figure out the pixels.

Each beat should have:

### Concept

The big idea for this beat in 2-3 sentences. What visual WORLD are we in? What metaphor drives it? What should the viewer FEEL? This is the most important part — everything else flows from it.

### Mood direction

Cultural and design references, not hex codes:

- "Geometric, rhythmic, precise. Think Josef Albers or Bauhaus color studies."
- "Warm workspace. Nice notebook energy, not technical blueprint."
- "Cinematic title sequence. The kind of opening where you lean forward."

### Animation choreography

Specific motion verbs per element — not "it animates in" but HOW:

| Energy        | Verbs                                         | Example                               |
| ------------- | --------------------------------------------- | ------------------------------------- |
| High impact   | SLAMS, CRASHES, PUNCHES, STAMPS, SHATTERS     | "$1.9T" SLAMS in from left at -5°     |
| Medium energy | CASCADE, SLIDES, DROPS, FILLS, DRAWS          | Three cards CASCADE in staggered 0.3s |
| Low energy    | types on, FLOATS, morphs, COUNTS UP, fades in | Counter COUNTS UP from 0 to 135K      |

Every element gets a verb. If you can't name the verb, the element is not yet designed.

### Transition

How this beat hands off to the next. Specify the type and parameters.

**When to pick which:**

| Choose shader transition for                                                    | Choose CSS transition for                                                           | Choose hard cut for                                            |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Reveals, big reaction shots, product/logo unveils, energy shifts, "wow" moments | Continuous camera-motion beats where the scene feels like one move broken into cuts | Rapid-fire lists, percussive edits on the beat, comedic timing |
| Any moment the music/VO punctuates with a downbeat or SFX hit                   | Beats that ease from one composition into the next with shared motion vocabulary    | Sequences of 3+ quick tempo-matched switches                   |
| Brand moments where the transition itself _is_ the visual                       | Minimal/editorial pacing                                                            | Anytime a 0.3-0.8s transition would feel too slow              |

Rule of thumb: if the beat is the _centerpiece_ of the video, shader-transition into it. If the beat is connective tissue, CSS-transition. A brand reel of 5-7 beats usually wants 1-2 shader transitions (the hero reveal + the CTA) and the rest CSS or hard cuts — too many shader transitions flatten their impact.

**CSS transitions** (choose from `skills/hyperframes/references/transitions/catalog.md`):

- Velocity-matched upward: exit `y:-150, blur:30px, 0.33s power2.in` → entry `y:150→0, blur:30px→0, 1.0s power2.out`
- Whip pan: exit `x:-400, blur:24px, 0.3s power3.in` → entry `x:400→0, blur:24px→0, 0.3s power3.out`
- Blur through: exit `blur:20px, 0.3s` → entry `blur:20px→0, 0.25s power3.out`
- Zoom through: exit `scale:1→1.2, blur:20px, 0.2s power3.in` → entry `scale:0.75→1, blur:20px→0, 0.5s expo.out`
- Hard cut / smash cut (for rapid-fire sequences)

**Shader transitions** (choose from `packages/shader-transitions/README.md`):

- Cross-Warp Morph (organic, versatile) — 0.5-0.8s, power2.inOut
- Cinematic Zoom (professional momentum) — 0.4-0.6s, power2.inOut
- Gravitational Lens (otherworldly) — 0.6-1.0s, power2.inOut
- Glitch (aggressive, high energy) — 0.3-0.5s
- See `packages/shader-transitions/README.md` for the full API, available shaders, and setup

### Depth layers

What's in foreground, midground, and background. Every beat should have at least 2 layers:

- "BG: dark navy fill + subtle radial glow. MG: stat cards with drop shadow. FG: brand logo bottom-right."

### SFX cues

What sounds at what moment:

- "On the capture pulse — a soft, warm analog shutter click."
- "Left side carries a faint low drone. On fold: drone cuts. Silence. Then a single clean chime."

---

## Rhythm Planning

Before writing HTML, declare your scene rhythm: which scenes are quick hits, which are holds, where do shaders land, where does energy peak. Name the pattern — fast-fast-SLOW-fast-SHADER-hold — before implementing.

| Video type             | Typical rhythm pattern            |
| ---------------------- | --------------------------------- |
| Social ad (15s)        | hook-PUNCH-hold-CTA               |
| Product demo (30-60s)  | slow-build-BUILD-PEAK-breathe-CTA |
| Launch teaser (10-20s) | SLAM-proof-SLAM-hold              |
| Brand reel (20-45s)    | drift-build-PEAK-drift-resolve    |

---

## Velocity-Matched Transitions

Exit the outgoing beat with an accelerating ease (power2.in or power3.in) plus a blur ramp. Enter the incoming beat with a decelerating ease (power2.out or power3.out) plus blur clear. The fastest point of both easing curves meets at the cut — the viewer perceives continuous camera motion, not two discrete animations. Match exit velocity to entry velocity within ~5% tolerance.
