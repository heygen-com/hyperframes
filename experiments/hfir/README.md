# hfir — assembly for programmatic video

**Status: experiment. Not shipped, not supported, not on any roadmap. It exists to answer one question with evidence instead of opinion.**

## The question

Every code-to-video framework, ours included, is designed to be intuitive to a human. But increasingly no human reads the source. Agents write it, and agents want the opposite of what humans want: not terseness and convention, but explicitness and dials.

So: **what if an agent never wrote HTML at all?**

## What this is

A flat table of `(op, frame, element, property, value)` that compiles to a renderable composition. This is a complete scene:

```
CANVAS  1280 720 30
FRAMES  60

DECL    box   rect
DECL    tag   text

SET   0   box  x 120
SET   0   box  y 260
SET   0   box  w 200
SET   0   box  h 200
SET   0   box  fill #E0322C
SET   0   box  opacity 0

RAMP  15  box  opacity 1
RAMP  45  box  x 960
RAMP  45  box  fill #0F7A52

SET   30  tag  text FRAME_30_EXACTLY
```

There is no HTML, no CSS, no cascade, no box model, no layout engine, and no easing vocabulary.

## The one design decision that matters

`SET` and `RAMP` are different opcodes.

- `SET` is a hard step. The value holds until the next op.
- `RAMP` interpolates linearly into the stated value.

Interpolation is declared **per property, per segment**. There is no implicit tween, no eased default, and no `ease-out` to misinterpret. If a property moves, something said so.

That is the whole "assembly" idea: the agent addresses the machine directly and nothing is inferred on its behalf.

## Try it

```bash
node experiments/hfir/compile.mjs experiments/hfir/scene.hfir /tmp/hfir/index.html
npx hyperframes render /tmp/hfir
```

Compiles 22 ops into 15 animations and renders 60 frames of 720p in **~2.5 seconds**.

## Verified, not asserted

The example scene was rendered and the frames checked against the table by eye:

| Frame   | The table says  | The pixels show                                                                  |
| ------- | --------------- | -------------------------------------------------------------------------------- |
| 0       | `box opacity 0` | box genuinely absent, text white at exactly (120,120)                            |
| 29 → 30 | `SET` is a step | white `NO_HTML_WAS_HARMED` on 29, blue `FRAME_30_EXACTLY` on 30, nothing between |
| 45      | two `RAMP`s     | box at x=960, colour interpolated red → green                                    |

## Why it targets WAAPI

The compiler emits Web Animations API keyframes rather than CSS keyframes, because seeking a WAAPI animation by `currentTime` is the path our render engine treats as authoritative, and it is a Baseline web standard rather than a Chromium internal.

The useful consequence: the IR gets browser-grade text shaping, compositing and colour **for free**, while the agent never touches any of it. The browser stays the renderer; only the authoring surface changes.

That is also the argument against building a native renderer for this. The explicitness people want from "native" turns out to be a compiler problem, not an engine problem, and solving it this way keeps the installed renderer, the standards floor, and the enormous amount of HTML/CSS in every model's training data.

## What it cannot do yet

Named honestly, because these are the reasons it might not be worth pursuing:

- **No layout.** Everything is absolute pixels. Fine for a machine, miserable for a human, and it means no responsive or flow-based composition.
- **No text wrapping.** Though `window.__hyperframes.pretext` now measures text without a reflow, so an agent could compute wrap points and emit them as explicit ops. That is the natural next step.
- **Text is the leak.** WAAPI cannot animate text content, so it is driven by a discrete per-frame table instead. It is the one place the mapping is not 1:1.
- **No media, no sub-compositions, no audio.** Audio in particular could not be inferred; it would need its own ops.

## The experiment worth running next

This prototype only proves the idea is _possible_. It does not prove it is _better_.

The test that would settle it: give an agent the IR spec and the HTML spec cold, same prompts, and measure first-valid-render rate and repair loops for each. Nobody in the category publishes that number for any format, which is its own opportunity.

If the IR wins, we have found something real. If HTML wins, we have cheaply killed a good-sounding idea, which is worth just as much.
