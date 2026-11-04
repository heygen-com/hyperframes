# Motion

## Motion craft

Measured frame by frame from the official HyperFrames launch films. These are defaults: a reference the person gave, or a Moment that does otherwise on purpose, wins for its own beat.

- **Moves**: a fast move takes 0.3–0.6 s and carries motion blur on its own ease, peaking at its fastest frame: 6–12 px on text-sized elements, 15–20 px full-frame, horizontal-only on a horizontal move. One move is one tween.
- **Render-time blur**: for fast 2D movers, `data-motion-blur="on"` on the composition root smears them along their real path in preview and render (opt-in; also `data-motion-blur-shutter` for a longer smear, 360 is strong; `-events="on"` when the motion is set from a timeline callback such as a `render(t)` function). Suggest it when the person asks for blur or a filmic look and the piece moves fast. It picks how to draw on its own: a cheap per-element filter for translation, the truer capture for spins and zooms; it works over WebGL and in any Chrome, and is off only for HDR and distributed renders. Opt a subtree out with `data-motion-blur="off"`, e.g. a seam that already carries its own blur. After adding it run `hyperframes check`. Guide: /guides/motion-blur.
- **Arrive slow, leave clean**: long-tailed ease-outs on arrivals; landing takes longer than leaving. An exit is one smooth motion, never slide, stop, then leave. Entrances that are too snappy read as glitches; slowing the whole video by about a second often fixes it.
- **Ease by role**: an arrival lands on a long tail (`expo.out`, `power4.out`), a camera move or a colour flood eases both ways (`power2.inOut`), a zoom through or an exit accelerates (`power3.in`). The same `power2.out` at 0.5 s on everything is the flat default that makes a film feel generated. Linear only for rotation, progress and constant speed that is the point.
- **Springs** are named by damping ratio: 1.0 never bounces, 0.7-0.85 reads premium, 0.4-0.6 playful, under 0.3 a cartoon. Position and size may bounce; opacity and colour never do. GSAP's `elastic.out(1, 0.5)` and `back.out(1.4)` are the nearest built-ins; a closed-form spring of `t` keeps any frame renderable on its own.
- **Exits** are 40-50% shorter than their entrances. **Overlap**: the next element starts when the previous is 30-50% done; fully sequential looks robotic, all at once looks cheap. **Stagger**: letters a frame apart, words 60-120 ms, list items 40-80 ms.
- **Beat grid**: frames per beat = fps × 60 / BPM; compute each beat from its index and round it, never add a rounded beat repeatedly (at 128 BPM and 30 fps that drifts 2 frames in 32 beats). Cut on the beat, change the layout on the bar.
- **Cuts**: cut at the fastest frame of a move, with matching direction and speed on both sides. A click into a new screen is a match cut on the click's rebound; the new screen comes in slightly large and settles.
- **Titles**: a landed title is dead still; the motion moves to the next element, the camera or the world behind. Vary the entrance within a film, never a fade and slide-up for each:
  - per word: `blur(6px)` → 0 and opacity 0 → 1 in 0.13 s, 0.067 s apart, no translate;
  - per word from light grey to ink, 0.07–0.1 s apart, no position change;
  - the whole line blurring in, 8 px → 0 in 0.13–0.2 s;
  - per letter for a name, 0.1 s apart, opacity 0.3 → 1 with a slight blur;
  - behind the subject: the title between the plate and a matte of the person;
  - one word of the sentence rolling through options like a slot machine, about 0.1 s a roll.
- **Holds**: a line the viewer must read holds about 0.5 s plus 0.3 s a word, the film's last line at least 2 s; a one- or two-word chapter line may hold 0.4 s. Then exit with a blur-out and fade of 0.13–0.25 s, word by word, or with the scene's move.
- **Title size**: 4–9% of the frame height, one or two lines; quiet lines at 2.5–4% against hero words that fill 60–90% of the width. One highlighted word in the accent colour, which carries meaning.
- **Rhythm**: contrast speeds. Montages cut every 0.13–0.8 s; a demo holds one framing for 7–10 s while the UI acts; shots average 1.8–3 s with motion inside them. Hold 0.3–0.75 s before the payoff, which plays at normal speed.
- **Continuous motion that works**: the product's UI working, footage playing, a character acting, a 3D world turning, a slow orbit of a background stage (3–5° a second).
- **Defaults that look generated**: breathing, floating or pulsing loops standing in for motion on titles and UI; titles that keep sliding or scaling after they land; a slow creeping scale on a title or a slow push late in a scene; bounce on UI; click rings; every scene entering the same way; every element fading and sliding up. A character's idle and overshoot are acting, not these (`types/character.md`).

## Transitions with a cause

Use 3–5 kinds in a film, each caused by something on screen. Hard cuts belong inside a scene (punch-ins); at most a third of the seams between beats are hard cuts, and worlds never crossfade into each other. Measured on the official films:

| Transition               | How it is built                                                                                                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zoom through a button    | the camera tracks to the button with blur (0.6 s), then the button scales from ~8% to ~250% of the frame in 0.35 s, strong ease-in; its fill becomes the next frame                 |
| Object becomes the world | a pill or card grows past the frame in 0.65 s, ease-in-out, its radius shrinking; what was around it blurs ~15 px and fades in 0.3 s; the new content fades in while it still grows |
| Morph                    | one container widens into the next (icon card → prompt box, ~110 → ~880 px in 0.2 s `power3.out`) with a horizontal blur 12 → 0                                                     |
| Carry across             | the result shrinks 1 → 0.6 with blur peaking at 6 px mid-move and lands inside the next app as it builds around it                                                                  |
| Colour flood             | the hero object stays while the whole ground changes colour in ~0.4 s `power2.inOut`                                                                                                |
| Whip                     | a horizontal or vertical smear of 0.13–0.3 s; the arriving element lands blurred and sharpens in ~0.13 s                                                                            |
| Iris from the click      | `clip-path: circle()` opens from the clicked point onto the next world in 0.15 s                                                                                                    |
| Dip cut                  | the outgoing frame darkens ~40% for 3 frames before a hard cut, so the cut reads as meant                                                                                           |
| Blur swap on one stage   | out: opacity → 0 with ~8 px blur in 0.13–0.2 s; in: blur → 0 in 0.13 s; the ground never cuts                                                                                       |

Registry versions: `npx hyperframes catalog --tag transition --json`.

| The person says        | Change                                                                         |
| ---------------------- | ------------------------------------------------------------------------------ |
| "too fast"             | Slow every zoom and pan to 0.7× of its speed, nothing else                     |
| "speed this up"        | Speed the content and shorten the beat by the same amount; later beats move up |
| "the titles move"      | Land them, then hold them dead still until they leave                          |
| "it feels like slides" | Enter the next scene through an object on screen; cut a move mid-flight        |

## The right mechanism

| Request                                 | Mechanism                                                                                                                  |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Punch-in, zoom, pan, Ken Burns, reframe | Tween `scale` and `x`/`y` on a wrapper inside the clip, never on the timed media element; chain the states on one timeline |
| Crop or mask reveal                     | Tween `clip-path` or a mask on an inner wrapper; source time is untouched                                                  |
| Constant speed change                   | `data-playback-rate` on the media, 0.1–10 (picture and pitch-preserved sound)                                              |
| Speed ramp                              | A `rate` lane in `data-automation` on the media (`t` in clip seconds, `v` 0.1–10); it overrides the constant rate          |
| Hold or freeze                          | Hold a final frame or a finished scene; a freeze mid-source needs a still exported first and placed as its own clip        |

Ready-made moves: `npx hyperframes catalog --tag camera --json`, or `catalog --query "<the move>" --tag motion-primitive --json`.

## Seeing motion

The whole-film pass (beat sheet, cuts, phone width, the craft warnings) is `review.md`. For one move:

- `npx hyperframes keyframes --json [--selector '#id'] [--runtime all]` lists keyframes and motion paths (GSAP, CSS, anime.js): property, time, value, ease.
- `npx hyperframes keyframes --shot motion.png --selector '#id'` draws the real element's samples over time with its path (9 samples; `--samples N`). `--layout strip` for motion in place, `--from`/`--to` for one stretch, `--angle iso|top|side|'yaw,pitch'` for 3D, `--ghost` for a `<canvas>`.
- `npx hyperframes snapshot --range 2,4 --frames 8` samples one stretch; `--composition <id>` samples one scene; `--at <t,…>` exact instants; `--zoom '#id'` a sharp crop; `--angle iso` depth and overlap.
- Against a reference video: `snapshot --at <t,…> --against ref.mp4` writes a side-by-side sheet.
- Assert intent instead of eyeballing it: a `<name>.motion.json` next to the composition makes `check` verify it on the seeked timeline, as errors (`motion_appears_late`, `motion_out_of_order`, `motion_off_frame`, `motion_frozen`):

```json
{
  "assertions": [
    { "kind": "appearsBy", "selector": "#headline", "bySec": 0.5 },
    { "kind": "before", "a": "#headline", "b": "#cta" },
    { "kind": "staysInFrame", "selector": ".card" },
    { "kind": "keepsMoving", "withinSelector": ".scene" }
  ]
}
```

## Common faults

| Symptom                          | Usual cause                                                                                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Blank or frozen scene            | Timeline registered before an async build finished, `visibility` tweened on a `.clip`, or a host id that differs from its scene's timeline key |
| Stutter or drift between renders | Layout measured in `onUpdate`, `requestAnimationFrame` or clock time; two timelines on one property                                            |
| Jump at a cut                    | Outgoing and incoming states differ at the seam: snapshot just before and after it                                                             |
| Ease looks off at a handoff      | Speeds don't match across the seam: mirror the ease (`power3.in` out, `power3.out` in)                                                         |

Studio's keyframe diamonds and motion-path handles rewrite the GSAP script in the composition file, so the person may have changed motion since you wrote it.
