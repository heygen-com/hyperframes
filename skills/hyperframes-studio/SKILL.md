---
name: hyperframes-studio
description: >
  Use when working with a person on a HyperFrames project in Studio: first,
  whether their message asks for a change at all (questions, loose ideas and
  "don't change anything" get an answer and a plan, not an edit); for a new
  film, the plan, storyboard, build order the HyperFrames launch films follow;
  and how the timeline should be laid out so it reads well (one caption track,
  one element kind per track, every scene a sub-composition) and where captions
  and key content may sit (safe zones). Don't use for how to perform an
  individual edit (split, trim, retime, volume, copy, swap): that is
  `creator-editing-recipes.md` in `/hyperframes-core`.
---

**Plugin installs:** Before setup or freshness commands, follow [plugin execution rules](../hyperframes/references/plugin-installation.md) when this skill is inside a HyperFrames plugin. Standalone installs keep the update instructions below.

# HyperFrames Studio conventions

Studio draws one timeline row per top-level element. A project that follows the
rules below opens as a short, readable timeline; one that does not opens as a wall
of unlabeled rows the user cannot edit. These are conventions for what to build.
For how to change a clip, follow `/hyperframes-core` `references/creator-editing-recipes.md`
and never invent a different form of the same edit.

## 0. Talk before you build

Read the message before you open a file. Decide what it asks for:

| The person                                                        | You                                                            |
| ----------------------------------------------------------------- | -------------------------------------------------------------- |
| asks a question ("why", "how", "can it", "what if")               | Answer it. Change nothing.                                     |
| says don't change anything, hold, "just thinking", "let's talk"   | Change nothing, not even a fix you noticed. Offer it in words. |
| brings an idea, a subject or a goal with no concrete change in it | Plan it (§ 5). Do not touch the film.                          |
| names a concrete change ("title bigger", "cut the third scene")   | Make it.                                                       |
| approves a plan or a storyboard ("build it", "go")                | Build what was approved, one beat at a time (§ 5).             |

When unsure, it is a conversation. A wrong answer costs one message; a wrong build costs a long
run and a round of notes.

A conversation reply:

- Answer first, in plain words, in a few sentences.
- Ask at most three questions, only ones whose answer changes the film. Give each a recommended
  answer and the trade-off ("real screen capture is more credible; an HTML mock scrubs better").
- When there is an idea to shape, offer two or three genuinely different directions, three lines
  each: the concept, the opening hook, and the real reference it borrows from. Recommend one.
- End with the next step and the word that starts it ("Say build and I'll make the first beat").

Keep the plan in the project, not only in the chat: the next message may start a new session that
cannot see this one. Write it to STORYBOARD.md (and storyboard.html once there are sketches);
neither changes the film. If the person asked you to change nothing at all, write nothing: put the
plan in the reply and offer to save it.

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

- Safe margins: everything visible stays inside the action-safe box (90%), and captions and key content stay inside the title-safe box (80%).
- Two-up and 50/50 layouts keep each half's content inside the title-safe box.

## 5. A new film: plan, storyboard, build

This is how the HyperFrames launch films were made ([hyperframes-launches](https://github.com/heygen-com/hyperframes-launches),
also the house reference reel). Each step waits for the person. The detail lives in the owning
guides; do not restate it here.

| Step          | What the person gets                                                                                                       | Owner of the detail                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1. Brief      | The message as a claim, who watches and where, length, sound, what real footage exists, and the open questions             | `/hyperframes` `references/intent-interview.md`                                              |
| 2. Directions | Two or three concepts, each with its hook and a named reference film; one recommended                                      | `/hyperframes` `references/pitch-round.md`                                                   |
| 3. Storyboard | A beat list, then a static contact sheet (storyboard.html) with a note per cell: what moves first, which way the seam goes | `/hyperframes-creative` `references/storyboard-recipe.md`, `story-spine.md`                  |
| 4. Build      | The first beat built and shown, then the rest in order, each its own sub-composition (§ 1)                                 | `/product-launch-video` `references/story-design.md`, `motion-language.md`, `cut-catalog.md` |
| 5. Notes      | Revisions to only the beats named, a new version, the runtime stated                                                       | `/hyperframes` `references/review-loop.md`                                                   |

Build the first beat and stop for a reaction before the rest: a wrong direction then costs one beat.
Never render until asked; the person reviews by scrubbing in Studio.

What the launch films add to those guides:

- **Real footage for the product being launched.** Ask for a screen recording in the brief and hold
  its slot with a labelled placeholder until it arrives. Never draw the launched product's UI.
  A third-party tool that appears as context (a chat app, an editor) is rebuilt faithfully from a
  capture, never approximated.
- **Name the product late.** Open on the viewer's pain or on proof already moving; no title card,
  no fade in.
- **One world.** The same window or canvas continues across beats. Scrub every cut: whatever
  persists must not jump.
- **One line on screen at a time, one accent word in it.** Split longer copy into timed lines.
- **The frame edge does the hiding.** Cursors and text leave through the edge, not by fading
  mid-frame. One motion at a time per element.
- **Sound is its own pass.** A voice-led film records the voice first and cuts to its words. A
  text-led film is built silent, then gets a click on every tap, a low music bed and sound effects
  only where they carry meaning.
- **Close on the command or the address,** with the logo landing in footage that is still moving.
- **Length grows under review.** State the runtime at every version; running past the target is
  the person's call, not yours.
- **Notes are felt reactions** ("jolty", "doesn't go long enough"). Find the cause, change the
  measurable thing, and say what the note meant and what moved. Keep the person's words verbatim
  in STORYBOARD.md under `## Changes from vN`.

## Checking your work

Run `hyperframes lint` and fix every finding. Then open the project in Studio and
check that the timeline shows a base row, one row per scene host, one caption row and the audio rows.
