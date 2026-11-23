# The spec

Adjectives are where the default look lives. Given "premium, modern, clean", the model fills every gap with its own defaults, and they look the same in every run: a dark void, a glow, small type floating in the middle, everything fading in. Every adjective you turn into a number is a decision taken back from those defaults.

So before any scene, write `SPEC.md` at the project root: the film as a director's brief to yourself, with a number wherever you would have written an adjective. Build from it, check against it, and change it when a review changes the film.

The spec serves the story, never the other way round (`story.md`). A look that turns the story's things into abstract shapes has failed, however striking the frame.

## The template

```text
GOAL:    what the viewer feels or does at the end, one sentence
OUTPUT:  HyperFrames, W x H, fps
TIME:    seconds x fps = frames; BPM and frames per beat when there is music
LOOK:    ground (hex, texture and its amount), ink, one accent and where it may appear;
         display face + weight + size in px + tracking, body face the same;
         the medium (paper and ink, photographs, product UI, glass, clay, 3D studio) with its numbers;
         light and depth: shadow offset, blur and opacity, grain %, vignette %
OBJECTS: every thing the story needs the viewer to recognise (a mirror, a clock, a phone, a person),
         drawn with the material and details that make it read without a label: a mirror is
         silvered glass with a bright edge and a mount, not a bar
MOTION:  eases by role as named curves (enter, move, exit, camera); springs as damping ratio;
         durations and staggers in frames
SHOTS:   one line per shot: frame range, the one hero move, what the viewer reads (with its window),
         the sound, and how it hands off to the next shot
BANNED:  the defaults below, plus anything this film must not become
QA:      the frames to check, and what each must show
```

## Turning words into numbers

| The word  | Becomes                                                                                                                                |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| premium   | a material with numbers: satin paper with 2% grain, a product on a seamless sweep with a 0.55 contact shadow, chrome at roughness 0.05 |
| modern    | a camera and a type system: a 30-frame push on one ease, a display face at 9% of the frame height with -2% tracking                    |
| clean     | a grid and a ration: 12 columns, 96 px margins, the accent on one word per shot                                                        |
| dynamic   | cuts on the beat, a layout change on the bar (every 4 beats), one hero move per shot                                                   |
| playful   | springs at damping 0.45-0.6 on position and scale (never on opacity or colour), 10-30% exaggerated poses                               |
| cinematic | a lens and a light: a 35 mm framing, a key from upper left, a rim from behind, 6% vignette                                             |

## Composition numbers

- The hero of a shot fills at least 40% of the frame's height or width. A small object in the middle of an empty frame is never a shot; push in, crop, or give it a world.
- One hero move per shot. Secondary moves travel 50-70% as far, start 100-200 ms after it, and everything else holds still.
- In a story film every shot moves the story: something happens that causes the next shot. Lines read as cause and effect ("so…", "which means…"), not slogans.
- An information card (B-roll over a talking head, a data beat, a vertical explainer card) is different: its information is on screen within about 2.5 s, then it holds, so any paused frame reads as a finished poster.
- Something new every 2-4 s across the film; a new layout every bar when there is music.
- Text meant to be read: at least 28 px at 1080 (2.6% of the short side), held 0.5 s + 0.3 s a word. Too many words: cut words, never shrink type.

## BANNED by default

These are where generated video lands when nothing else is decided. Each is banned unless the brand's own material or the person's reference uses it, and then only as they use it:

- a black or dark navy void as the ground, with small elements floating in its middle;
- glow, bloom, neon, lens flares, glowing orbs and rings; floating particles as decoration;
- purple or blue gradients, mesh gradients, glass cards;
- a cream or off-white paper ground with a serif display, italic accent words, numbered "01 / 02" labels, small monospace caps labels, pill-shaped chips and buttons;
- everything centred; everything fading in at once; every element fading and sliding up;
- text that moves while it is read; titles that keep drifting after they land;
- corner labels, frame borders, corner brackets, HUD readouts as decoration;
- three cards in a row, KPI grids, a title over a dimmed screenshot;
- the logo docked in a corner.

After the first render, name every default it used anyway, from this list or not, add each to the film's BANNED line, and fix them. The list grows with every film.

## A look built from a medium

A look holds together when it is the rules of one medium, not a palette. A risograph look, for example, is five parts and nothing else:

- **paper**: one flat colour with a fibre noise, no gradients;
- **ink A**: every word that must be read and every structural line;
- **ink B**: one fluorescent accent, one focus per frame (the number, the bar, the stamp);
- **overprint**: where the inks overlap a third colour appears, and the B plate sits 3 px off register;
- **halftone**: every gradient is dots.

Motion comes from the same medium: the frame is printed, plate by plate, not faded in. Write any look this way: its parts, what each may carry, and how the medium itself moves (paper is cut and lifted, ink is printed, glass refracts, clay is pressed).
