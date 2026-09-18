---
name: hyperframes-studio
description: >
  Use when building or editing a HyperFrames project that people open in
  Studio: how the timeline should be laid out so it reads well (one caption
  track, one element kind per track, every scene a sub-composition) and where
  captions and key content may sit (safe zones). Don't use for how to perform an
  individual edit (split, trim, retime, volume, copy, swap): that is
  `creator-editing-recipes.md` in `/hyperframes-core`.
---

# HyperFrames Studio conventions

Studio draws one timeline row per top-level element. A project that follows the
rules below opens as a short, readable timeline; one that does not opens as a wall
of unlabeled rows the user cannot edit. These are conventions for what to build.
For how to change a clip, follow `/hyperframes-core` `references/creator-editing-recipes.md`
and never invent a different form of the same edit.

## 1. Every scene is a sub-composition

The root composition holds only timed hosts, media and audio. Any scene with nested
structure (a div containing children, a title with a subtitle, a chart) is its own
file loaded with `data-composition-src`, wiring in
`references/sub-compositions.md`.

Nested markup left inside the root does not become a row of its own. It hides inside
one opaque row that cannot be trimmed or moved part by part.

Severity: the structure lint is one rule set with two severities. Studio reports it
as an error, the CLI as a warning. Author as if both are errors.

## 2. One caption track

- All captions live on one track: a single sub-composition host (one `data-track-index`)
  marked `data-track-kind="captions"` that carries every caption group in order.
- Never one row per caption group, and never captions mixed onto a track with
  another kind.
- Word-timing rules are unchanged: see `/embedded-captions` and the `caption_*` lint rules.

## 3. One element kind per track

Group by kind so each row is one thing the user can select, mute or drag as a set.

| Kind                                    | Track index                    |
| --------------------------------------- | ------------------------------ |
| Base video / A-roll                     | 0                              |
| Scenes, overlays, graphics              | 1 to 9, one kind per index     |
| Captions                                | 10                             |
| Audio (voiceover, music, sound effects) | 100 and up, one kind per index |

Mark a host's kind with `data-track-kind`: `captions` on the caption host, `graphics` on scene
and overlay hosts. Video and audio kinds come from the tag, so `<video>` and `<audio>` need no
attribute. Track index is display only; it never changes what renders on top. Use CSS for
layering.

## 4. Safe zones

Studio's preview can draw a ruler and a safe box over the player. That overlay lives in
the preview pane, never inside the composition, so do not add guide elements to the HTML.
Vertical and wide framings each have their own safe box.

| Framing              | Safe box                                                                | Caption band                    |
| -------------------- | ----------------------------------------------------------------------- | ------------------------------- |
| Wide (16:9)          | action-safe 93% of the frame, title-safe 90% (EBU R95, SMPTE ST 2046-1) | Bottom of the title-safe area   |
| Vertical (1080x1920) | Insets: top 250, bottom 484, left 140, right 140 (px)                   | Directly above the bottom inset |

- Keep captions and key content inside the safe box for the format being built.
- Two-up and 50/50 layouts keep each half's content inside the safe box.

## Checking your work

Run `hyperframes lint` and fix every finding. Then open the project in Studio and
check that the timeline shows a base row, one row per scene host, one caption row and the audio rows.
