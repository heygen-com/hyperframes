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

Author as if a structure lint rejects any violation.

## 2. One caption track

- All captions live on one track: a single sub-composition host (one `data-track-index`)
  marked `data-track-kind="captions"` that carries every caption group in order.
- Never one row per caption group, and never captions mixed onto a track with
  another kind.
- Word-timing rules are unchanged: see `/embedded-captions` and the `caption_*` lint rules.

## 3. One element kind per track

Group by kind so each row is one thing the user can select, mute or drag as a set.

| Kind                                    | `data-track-kind`      |
| --------------------------------------- | ---------------------- |
| Base video / A-roll                     | `video` (from the tag) |
| Scenes, overlays, graphics              | `graphics`             |
| Captions                                | `captions`             |
| Audio (voiceover, music, sound effects) | `audio` (from the tag) |

Put `data-track-kind` on sub-composition hosts. Video and audio kinds come from the tag, so
`<video>` and `<audio>` need no attribute. Give each kind its own `data-track-index`; the number
is display only; it never changes what renders on top. Use CSS for
layering.

## 4. Safe zones

Any ruler or safe-box overlay lives in the preview pane, never inside the composition, so
do not add guide elements to the HTML.
Both framings (wide and vertical) use the same two safe boxes, Premiere's defaults. The preview
toggle draws them with a tick at the midpoint of every edge. Source:
`ACTION_SAFE_PERCENT` and `TITLE_SAFE_PERCENT` in `packages/studio/src/utils/previewSafeMargins.ts`.

| Box         | Share of the frame | Inset on every edge |
| ----------- | ------------------ | ------------------- |
| Action-safe | 90%                | 5%                  |
| Title-safe  | 80%                | 10%                 |

- Keep captions and key content inside the title-safe box (80%).
- Two-up and 50/50 layouts keep each half's content inside the title-safe box.

## Checking your work

Run `hyperframes lint` and fix every finding. Then open the project in Studio and
check that the timeline shows a base row, one row per scene host, one caption row and the audio rows.
