---
name: hyperframes-studio
description: >
  Use when working with a person on a HyperFrames project in Studio: first,
  whether their message asks for a change at all (questions, loose ideas and
  "don't change anything" get an answer and a plan, not an edit); for a new
  film, the plan, storyboard and build order that the HyperFrames launch films follow;
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

| The person                                                                                 | You                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| names a change, however politely ("make the title bigger", "can you cut the third scene?") | Make it.                                                                                                                                                              |
| gives a felt note on the built film ("the intro feels jolty", "it doesn't go long enough") | Find the cause, change the measurable thing, say what the note meant and what moved, and record it per `/hyperframes-creative` `references/storyboard-recipe.md` § 4. |
| asks a question and names no change ("why does the title jump?")                           | Answer it. Change nothing.                                                                                                                                            |
| says don't change anything, hold, "just thinking", "let's talk"                            | Change no file, not even a fix you noticed. Offer it in words.                                                                                                        |
| brings an idea for this film with no concrete change ("I want the ending to feel bigger")  | Propose the change and add it to the plan (below). Change no composition file.                                                                                        |
| asks for a new film                                                                        | Plan it (§ 5).                                                                                                                                                        |
| approves a plan ("build it", "go")                                                         | Build what was approved.                                                                                                                                              |

A message that asks a question and names a change gets the answer and the change. Only when you
cannot tell whether it asks for anything is it a conversation: a wrong answer costs one message; a
wrong build costs a long run and a round of notes.

A conversation reply:

- Answer first, in plain words, in a few sentences.
- Ask only questions whose answer changes the film, each with a recommended answer and its
  trade-off ("30 seconds fits a feed; 60 leaves room for the demo").
- When there is an idea to shape: for a new film, directions per `/hyperframes`
  `references/pitch-round.md`; for an idea about this film, two or three options for the part named.
  Recommend one.
- End with the next step and the word that starts it ("Say build and I'll start").

Keep the plan in the project, not only in the chat: the next message may start a new session that
cannot see this one. Add it to STORYBOARD.md the way `/hyperframes-creative`
`references/storyboard-recipe.md` § 4 records a round; never overwrite locked frames. If the person
asked you to change nothing at all, write nothing: put the plan in the reply and offer to save it.

## 1. Every scene is a sub-composition

The root composition holds only timed hosts, media and audio. Any scene with nested
structure (a div containing children, a title with a subtitle, a chart) is its own
file loaded with `data-composition-src`, wiring in `/hyperframes-core`
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

The [hyperframes-launches](https://github.com/heygen-com/hyperframes-launches) films were made in
this order. Each step has an owner; follow it and do not restate it here.

| Step          | Owner                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Brief      | `/hyperframes` `references/intent-interview.md`. Inside an existing project, only a follow-on to the same film stays: a new version or a cutdown, same workflow and aspect. Ask its must-have questions, skip `hyperframes init`, never overwrite BRIEF.md or STORYBOARD.md, add a new dated section to each, and say so in the reply. A film with a different workflow or aspect starts a new project, and the reply says so. |
| 2. Directions | `/hyperframes` `references/pitch-round.md`                                                                                                                                                                                                                                                                                                                                                                                     |
| 3. Storyboard | `/hyperframes-creative` `references/storyboard-recipe.md`                                                                                                                                                                                                                                                                                                                                                                      |
| 4. Build      | The workflow the brief routes to (`/hyperframes` § 2) and its own references                                                                                                                                                                                                                                                                                                                                                   |
| 5. Notes      | `/hyperframes` `references/review-loop.md`                                                                                                                                                                                                                                                                                                                                                                                     |

What the launch films add, for a product launch. Where the workflow's chosen arc says otherwise,
the arc wins.

- **Real footage for the launched product.** Ask for a screen recording in the brief unless the workflow captures it itself (a site from its URL), and hold its
  slot with a labelled placeholder until it arrives. Never approximate the launched product's UI. A
  third-party tool shown as context (a chat app, an editor) is rebuilt faithfully from a capture.
- **One world.** The same window or canvas continues across beats. Scrub every cut: whatever
  persists must not jump.
- **Cursors and scrolled content.** A cursor, or content the window itself scrolls out, leaves
  through the window or frame edge, not by fading mid-frame. Element and text swaps follow the
  workflow's `cut-catalog.md` where it has one.
- **Close on the command or the address,** with the logo landing in footage that is still moving.
- **State the runtime at every version.** Running past the target is the person's call, not yours.

## Checking your work

Run `hyperframes check` (it runs lint) and fix every finding. Then open the project in Studio and
check that the timeline shows a base row, one row per scene host, one caption row and the audio rows.
