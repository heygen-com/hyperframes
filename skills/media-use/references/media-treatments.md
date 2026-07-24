# Media treatments

A media treatment is a source-aware plan that composes existing HyperFrames
color, effect, timeline, and Registry primitives. It is not a second runtime
schema. Use this file to choose a primary direction. A matching recipe is an
optional tested seed; bespoke requests may assemble a validated treatment from
the canonical capability catalog.

## Permission and scope

- An explicit request such as "polish this", "make it look better", or "make it
  fit the topic" delegates a conservative treatment. Apply it, verify it, and
  report what changed.
- During an unsolicited opportunity scan, show or suggest the treatment first.
- Target meaningful photographic media. Skip text, SVG, logos, icons, UI
  chrome, and intentionally stylized footage unless the user asks.
- Realtime grading and effects apply to the entire selected real `<img>` or
  `<video>`. They do not isolate or track a face, plate, address, or other
  region. For region-only work, first create a separate cropped/masked media
  layer or use an external segmentation/tracking tool; never imply that a
  whole-media Blur or Pixelate performed region isolation.
- The realtime treatment path is Rec.709/SDR. Do not silently process HDR, HLG,
  PQ, or camera LOG sources through it.

## Classify the request

Choose the smallest lane that satisfies the request before choosing a recipe
or assembling a custom treatment:

| User intent                                         | Lane                                       |
| --------------------------------------------------- | ------------------------------------------ |
| too dark, flat, too warm, too many shadows          | correction                                 |
| polished, premium, warm, cinematic, fit the topic   | preset or custom treatment                 |
| retro, print, ASCII, glitch, camcorder              | shader effect or effect-bearing preset     |
| obscure the whole selected media                    | privacy Blur or Pixelate                   |
| hide one face, plate, address, or screen region     | separate crop/mask/asset or external tool  |
| draw attention to media without changing its pixels | framing, motion, or optional overlay       |
| reveal, focus, depixelate, fade the treatment       | finite seek-safe treatment keyframes       |
| REC HUD, light leak, flash, freeze-frame cutout     | Registry overlay plus any justified pixels |

The lane identifies the primary reason for the change; it is not a one-feature
limit. A final treatment may combine correction, a preset, finishing, multiple
compatible shader effects, finite keyframed values, and optional overlays when
the inspected media and user intent justify the complete combination. Keep one
primary intent as the creative anchor so the result remains coherent and
deterministic.

Do not add a stylized Effect when correction solves the complaint. Do not
change color when the request is only temporal, and do not install an overlay
when the selected media alone communicates the result.

Match strength to intent. When the user explicitly names a bold look such as
VHS, glitch, ASCII, halftone, camcorder, print, or engraving, apply its
signature effects strongly enough to read unmistakably. The guard against
unrequested additions does not mean under-delivering an effect the user asked
for. Correction and polish stay restrained; named stylization must be obvious
in the after-frame.

### Translate vague feedback conservatively

| User feedback                         | First action                                                                                    | Add only when the frames justify it                             | Never infer                                     |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------- |
| too many shadows and a bit boring     | lift shadows/protect highlights, then compare one restrained source-appropriate preset          | mild contrast or vibrance                                       | retro texture, HUD, or palette effect           |
| make the product footage feel premium | protect product color and labels, compare Product Polish                                        | restrained vignette on lifestyle footage                        | a cinematic LUT or crushed blacks               |
| make this reveal cooler               | preserve color and animate one supported effect or treatment value                              | a short owned overlay block                                     | unrelated whole-clip styling                    |
| make it feel like an old home video   | compare 8mm and VHS language against the source                                                 | finite weave/flicker or justified HUD                           | that every old-video request means VHS          |
| hide this face                        | explain that realtime effects are whole-media; isolate the region first or use an external tool | whole-media Blur/Pixelate only when the user accepts that scope | face tracking or masking that was not performed |
| keep the brand colors exact           | leave UI/logo pixels unchanged; use framing and motion                                          | demonstrated exposure-only correction                           | stylized preset, palette, or LUT                |

When more than one lane could fit, generate at most two candidates and choose
from inspected before/after evidence. Ordinary correction or polish starts with
one candidate; a second candidate is an escalation, not the default. Do not
stack effects merely to make the answer look more sophisticated.

## Seed or assemble

Use the table when a tested recipe directly fits. Read only that recipe
section. Recipes are optional macros, not a closed list of allowed results.

| Intent or source                                         | Recipe heading to read                            |
| -------------------------------------------------------- | ------------------------------------------------- |
| Talking head, interview, presenter, people-focused photo | `Natural Portrait`                                |
| Product footage, lifestyle footage, clean social polish  | `Product Polish`                                  |
| Screen capture, dashboard, website, app UI               | `UI Fidelity`                                     |
| Warm memory, restrained nostalgia                        | `Film Memory`                                     |
| Creator/UGC handheld camera character                    | `Creator Camcorder`                               |
| Analog tape playback                                     | `VHS Playback`                                    |
| Small-gauge home-movie character                         | `8mm Home Movie`                                  |
| Editorial dots or ink print                              | `Editorial Halftone` or `Two-Ink Editorial Print` |
| Monochrome dot/line screen print                         | `Monochrome Screen Print`                         |
| Engraved or hand-hatched illustration                    | `Engraved Illustration` or `Crosshatched Sketch`  |
| Curved scanlined display                                 | `CRT Display`                                     |
| Glyph-based art                                          | `Procedural ASCII`                                |
| Realtime palette quantization                            | `Ordered Palette Dither`                          |
| Exact historical error diffusion                         | `Cached Error Diffusion`                          |
| Finite warm flare layer                                  | `Organic Light Leak`                              |
| Held-frame graphic interruption                          | `Freeze-Frame Cutout`                             |
| Short exposure-flash transition                          | `Social Flash / Editorial Reveal`                 |

Use `rg -n '^## <heading>$' <SKILL_DIR>/references/media-treatment-recipes.md`,
then read only from that heading to the next `##`. Do not load the entire
cookbook for one request.

When source intent is unclear, inspect the concise capability overview:

```bash
hyperframes media-treatment --capabilities --json
```

It lists the complete surface by family with one-line descriptions. Then load
only the family, effect, preset, or palette relevant to the inspected source:

```bash
hyperframes media-treatment --capabilities --capability <id> --json
```

The focused result provides legal controls, recommended apply values, render
cost, palette support, and the exact animation contract when supported. Use
`--all` only for tooling/tests or a genuinely exhaustive audit. Compose one
nested payload from these existing parts. Recipes and catalog-built payloads
use the same renderer and persistence contract.

Treat `renderLane: "multipass"` as a cost signal. Blur, Bloom, and Kuwahara are
bounded but more expensive than single-pass effects; avoid stacking several of
them across many simultaneous media elements unless the composition needs it,
then verify playback and a draft render.
Cost follows treated pixel area as well as element count. More than two
simultaneously visible full-frame multipass media layers requires a continuous
playback check on the target machine; simplify or pre-render the stack if it
drops frames. Do not impose or claim a universal hard cap from one machine.

## Common workflow

1. Confirm the target is a real `<img>` or `<video>` and inspect source color
   metadata.
2. For an image, read it once. For video, capture early/middle/late output as
   one labeled sheet and read that one image:

   ```bash
   hyperframes snapshot <project> --frames 3 --no-end --describe false \
     --output snapshots/treatment-before
   ```

   Read `snapshots/treatment-before/contact-sheet.jpg`; do not spend separate
   model turns reading each frame unless the sheet exposes a specific problem.
   Do not infer semantics from signal statistics alone.

3. Choose one primary lane. Use one matching recipe as a tested seed, or read
   the overview and one focused capability detail when the request is bespoke.
   A seed may be changed or combined with compatible catalog controls when the
   contact sheet justifies it. Do not invent keys, exceed reported ranges, or
   stack effects without a visual reason. Do not run the generic grade/LUT
   resolver first; it adds irrelevant candidates and may download an unused
   LUT. Use `grade --for --analyze` only when correction needs measured signal
   evidence.
4. Persist pixel settings with `hyperframes media-treatment`; it validates and
   writes the existing nested `data-color-grading` contract. Use registered
   GSAP only for supported animated values and Registry overlay blocks only
   for authored dressing.
   ```bash
   hyperframes media-treatment --selector "<unique selector>" \
     --grading '<nested JSON payload>' --json
   ```
   For a temporal reveal, use the focused capability result's `animation`
   contract. If it is `null`, the capability is static. Author the starting CSS
   property inline on the real media element and return temporary treatment
   values to neutral so the finished shot preserves its existing pixels.
   Prefer that bounded media animation first; if an overlay is justified,
   install the owned Registry block instead of recreating it with bespoke
   overlay markup.
   For correction and ordinary polish, keep those values as editable
   preset/adjustment JSON; do not generate a LUT for controls the realtime shader
   already owns.
   Use the canonical `details`/`effects` fields for vignette, grain, blur,
   pixelate, and related primitives. Do not duplicate them with CSS filters,
   SVG turbulence, opacity, or decorative DOM overlays.
5. When the treatment calls for an overlay, install that named block with
   `hyperframes add <name> --dir <project> --no-clipboard --json`, inspect its
   returned `data-composition-src` host, and place it once using the block's
   timing contract. Check for the installed file and host element
   ID before insertion; never duplicate an existing overlay block. This is one
   treatment workflow: do not make the user discover Catalog or separately ask
   for the recipe's justified overlay.
6. For ordinary correction/polish, capture one after-sheet with the same three
   timestamps under `snapshots/treatment-after`, compare it to the before-sheet,
   and stop when the result is clearly better. Run the normal project check;
   do not encode a draft solely to prove a static correction.
7. Escalate only when evidence requires it. Read individual frames to diagnose a
   specific visual problem. Preview and render moving evidence when judging
   treatment keyframes, glitch/tape motion, overlays, playback smoothness, LUT
   timing, or any other temporal behavior. HDR/LOG, privacy, and brand-sensitive
   work also require the existing explicit caveats and stronger verification.
   If the treatment is not clearly better, keep the source unchanged.
8. Report the selected media, primary intent, recipe seed if used, final
   composed controls, optional overlays, and the frames/render that were
   actually checked. Do not report visual quality from command success alone.

`resolve --type grade --for ... --analyze --json` provides deterministic
clipping and signal evidence, not subject recognition or automatic taste.
