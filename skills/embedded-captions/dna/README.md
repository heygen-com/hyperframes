# DNA registry — pick a visual language, not a preset

A **DNA** is a complete, art-directed visual language: typeface, palette logic, motion
grammar, and hero orchestration. It **parameterizes per scene** instead of shipping a
fixed look: the accent color is sampled from THIS scene, the contact shadow falls along
THIS scene's light, embed text blur matches THIS scene's depth-of-field, and the hero's
entrance amplitude follows how hard the word was actually spoken (RMS).

This replaces the template grab-bag. Six deep languages × scene adaptation beats 54
shallow presets — every render is already fitted to its footage.

## Category lock (deliveries field, enforced by the compilers)

Every classic DNA's **home is Cinematic (column)** — that is where all ten were
built and validated. (Standard/rail mode was retired 2026-06-12; the verbatim-rail
need is served by the `anchor` theme. The old rail combos live in
`~/Downloads/embedded-captions-archive/`.)

## The ten

| DNA             | Register       | Scene fit                                       | Voice                                                                                                                                                                       |
| --------------- | -------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **cream**       | premium-warm   | dark / mid warm scenes (band luma < 150)        | Inter, warm cream, screen blend, glowing emergence hero. The poetic default.                                                                                                |
| **ink**         | premium        | **bright scenes (band luma > 150)**             | Inter, near-black, multiply blend — type reads as _printed on_ the wall. Fixes the bright-scene hole.                                                                       |
| **editorial**   | editorial-luxe | introspective / fashion / poetic, mid-dark      | Bodoni Moda, bone, _lowercase italic hero_ — magazine elegance over shout.                                                                                                  |
| **keynote**     | tech-premium   | product / launch / founder updates              | Inter 800, opaque white, line-wipe reveals, hero wipes UP. Stillness = confidence.                                                                                          |
| **documentary** | formal         | interviews, serious subject matter              | Inter, bone, **burn-in reveals**, no hero. Gravitas IS the style.                                                                                                           |
| **loud**        | loud           | hype / sport / music / social                   | Anton, scene-sampled accent hero, single-unit slam + caption-layer ripple; **body announces in front** (`bodyLayer: "fg"` — k-pop depth, deliberate).                       |
| **neon**        | loud-cyber     | cyberpunk / nightlife / tech-noir (dark scenes) | Orbitron + electric cyan; words flicker-ignite like tubes; the hero **powers ON** with a strobe and hums (glow 0.5).                                                        |
| **glitch**      | loud-cyber     | digital / hacker / AI / dystopia                | Space Grotesk; **RGB-split echo layers converge** as each beat lands; 0.10–0.12s machine percussion; landing bumps co-visible captions 2px.                                 |
| **chrome**      | loud-luxe      | Y2K / fashion-tech / music                      | Audiowide cast in a **liquid-metal gradient** (background-clip:text on the word spans); one sheen sweep crosses the hero during the hold.                                   |
| **velocity**    | loud-sport     | sport / automotive / fitness                    | Teko italic; every word arrives **along its motion vector** (streak + skew settling upright); the hero passes through with blurred speed-trail echoes and looms while held. |

### fx fields (hero block) the engine understands

`entrance: emergence | settle | slam | rise | wipe-up | flicker-on | streak` ·
`glow` (0–0.5) · `echoes: [{dx,dy,color,opacity,blur}]` (converge-on-land duplicates) ·
`sheen: true` (gradient sweep — pair with `wordCss` background-clip) · `wordCss`
(per-word treatment; required for background-clip:text, which can't clip through
composited children) · `ripple` (px — landing bump, captions only) · `loom` / `breathe`
(hold-life) · `letterBlur` · `bodyLayer` (top-level: default layer for narration lines).

## How to pick (agent)

1. Read `safe-zones.json` → `heroAnchor.bandLuma` + `palette.temperature`.
2. Bright band (>150) → **ink** (never fight a bright scene with cream/screen).
3. Else pick by content register: poetic/warm → **cream** · introspective/luxe →
   **editorial** · product/tech → **keynote** · serious/interview → **documentary** ·
   hype/social → **loud**.
4. State the pick + why in one line; the user decides (SKILL.md Step 0 still applies).

## Authoring

- Cinematic mode: `cinematic.json` → `"dna": "<name>"` (drop the `template` field).
- Locked per DNA: family, palette scheme, blend, motion curves, hero orchestration.
- Open per group (unchanged): size / weight / style / case / spacing + planes.
- `var(--accent)` is available in per-group CSS — it resolves to the scene-sampled accent.

## What the engine generates from the DNA (no authoring needed)

- **Hero three-act**: co-visible captions dim 0.35s before the hero lands (setup) →
  entrance with per-letter stagger, amplitude ∝ spoken loudness (impact) → slow breathe
  - glow until exit (afterglow).
- **Scene optics**: depth-match blur on embed captions, light-direction contact shadow.
- All deterministic — measured from files, no randomness.

## Climax selection — what earns the promotion

Pick the **payoff, not the topic**: the words you would quote when paraphrasing the
beat. "The stars were only limited by the pixel size" — the payoff is **pixel size**
(the surprising claim), not "stars" (the subject). Test: would the word alone, big on
screen, make the listener nod? A topic word makes them wait.

- **Phrases are legal** (`match: "pixel size"` / `"skin food"`): a peak is a semantic
  unit, not necessarily one token. 2–4 words max — beyond that it's a sentence, not a
  peak.
- **Prefer clause-final** — nothing left dangling to place after the lift.
- **Never strand a determiner**: lifting "stars" out of "The stars…" leaves an orphan
  "The" that vanishes mid-air. The compiler auto-absorbs a line-leading article into
  the promoted phrase; mid-line, match the phrase including its article.
- Sizes are TARGETED by the compiler, not just floored — author sizes are hints:
  - **apex = frame event**: under 88% of usable width → raised toward a 93% fill.
    Std height cap = `sizeRange[1] × 1.25` (≤46cqh; formal register ×1.0) — a std apex
    bursts a rail, not a body composition. Cinematic cap = `sizeRange[1]`.
  - **short words fill with TRACKING**: when the height cap binds before the width
    target (SHINE — 5 glyphs), the compiler letterspaces up to +0.32em until the word
    owns ~88% of the width (film-title craft: HER / DUNE). Long words fill by scale,
    short words by air — impact is WIDTH-led either way.
  - **minor = damped beat in the apex family**: `max(3× rail, 0.55× apex-final)`,
    width-capped. A peak that reads as a label is a bug.
  - **lockup context is RATIO-LOCKED**: kicker/tail = `0.26× hero` (clamped
    0.05–0.085·h), recomputed after any width-fit raise. Don't hand-tune context
    sizes — size the hero; the context follows like a poster system.

## Climax placement — the lockup is the default, NOT the only composition

A hero line takes `"placement": "subject" | "column"`:

- **subject** (default) — the **ORBIT lockup** centered ON the subject. NOT a centered
  sandwich: context anchors to the hero's EDGES like a poster kicker/tagline —
  pre-context flush-left off the hero's top-left corner, post-context flush-right off
  its bottom-right — so the small lines land BESIDE the head/shoulder (on the scene),
  never on the face, and therefore EMBED (bg) like everything else. The eye reads a
  diagonal: kicker ↘ HERO ↘ tail. Only the hero crosses the silhouette (the
  matte-occlusion showcase). The context's job is reading continuity — it gets the
  margins; the hero's job is the cinematic event — it gets the subject. Right when the
  peak is THE dramatic moment: cream / loud / glitch / neon / velocity lean here.
- **column** — the apex stays IN its column's reading flow and BURSTS it (oversized,
  full hero motion + dim/glow privileges, but composed within the sentence's home
  zone; spills toward the subject naturally when oversized). Right when the content
  is a continuous read and the column is the narrative's home: keynotes, tutorials,
  explainers, documentary. Registers: keynote / documentary / editorial lean here.

Applying ONE composition to every peak is monoculture — the same failure the motion
review caught. Pick per beat: a 15s explainer might run column peaks throughout and
save the subject lockup for the single apex. (A third pattern — the editorial split,
bg context upper + fg hero lower-third — lives in references/composition-craft.md and
is the next placement candidate.)

## The motion language (five layers, each DNA answers all five)

A DNA's animation is not a parameter tweak on a shared fade — it's a distinct physics:

| Layer                  | What it governs                                                                                                    | Where it lives                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| **word entrance**      | how each word materializes on its beat ({y,x,blur,scale,rot,dur,ease} or burn)                                     | `motion.soft/present/impact`                          |
| **line exit**          | direction + speed of leaving, optional top-to-bottom cascade                                                       | `motion.exit` ({dur,y,x,scale,ease,stagger})          |
| **hold-life**          | what text does while on screen — stillness is a deliberate choice                                                  | `hero.breathe` / `hero.loom` (0 = print-still)        |
| **hero orchestration** | the three-act entrance signature (emergence / settle / slam / rise / **wipe-up**) + glow / letterBlur / **ripple** | `hero.*`                                              |
| **timing physics**     | the duration & easing register everything obeys (percussive 0.15s ↔ atmospheric 0.6s)                              | implied by the values above — keep one family per DNA |

Shipped signatures: cream = _light condenses_ (blur-settle, drift-up exits) · ink =
_letterpress_ (scale-press, no float, dead-still) · editorial = _the pen glides_
(x-glide with the italic, cascade-out page turns) · keynote = _surgical reveal_
(burn words + line wipe + hero wipe-up, exits never move) · documentary = _burn and
hold_ (motion's absence IS the language) · loud = _percussion_ (back-eased punches,
alternating tilt, hero ripple that bumps every caption — never the footage).

Rules inherited from hyperframes motion-principles: exits faster than entrances; vary
ease families BETWEEN DNAs (not within one); `.out` enters, `.in` leaves; never two
transform tweens on one element in the same window (wipe-up is clip-path so the
afterglow scale channel stays free; loom subsumes breathe).

## Adding a DNA

Copy an existing `dna/<name>.json`, change the voice, keep the schema. The engine
(`modes/cinematic/engine.html`) and both compilers consume it as-is. A DNA earns its
place by being a _distinct voice with a reason to exist_ — not a recolor.
