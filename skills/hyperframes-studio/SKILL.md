---
name: hyperframes-studio
description: >
  Work as the coding agent HyperFrames Studio runs. Use when a prompt arrives titled
  "HyperFrames element edit request", when the working directory is a Studio project being edited
  live, or when you need to know what an agent can do inside Studio: the element edit request
  format, the run queue, and OverlayState — the line an agent emits to drive what the selection
  overlay shows on the canvas while it works.
---

# HyperFrames Studio

Studio is the browser editor for a HyperFrames project. It can run **your own CLI** against the
composition: the user selects an element (or a timeline clip), types an instruction, and Studio
spawns `claude`, `codex`, `hermes`, `openclaw` or a harness they registered, with the prompt on
stdin and the project directory as the working directory.

If you are reading this because such a prompt arrived, you are that agent. Everything below is
what you can do from there.

## The request you receive

Studio builds the prompt. It arrives as `## HyperFrames element edit request v1` and carries:

| Field | What it is |
| --- | --- |
| `Composition` / `Source file` | The `.html` to edit. Edit that file, not the bundle. |
| `DOM id`, `Selector`, `Selector index` | How to find the element. The index disambiguates a repeated selector. |
| `Playback time` | Where the playhead was — the frame the user was looking at. |
| `Bounds`, `Text`, `Text fields` | The element as rendered, and its editable copy. |
| `Inline styles` / `Computed styles` | Authored, then browser-resolved. Prefer changing the authored one. |
| `Target HTML` | The tag itself, when Studio could isolate it. |
| `Also selected` | A multi-selection: apply the same change to every element listed. |

Guardrails come with the prompt. The short version: change what was asked on the elements named,
leave everyone else's timing and `data-*` alone, and prefer editing an existing style over adding
a new selector.

## OverlayState — say what you are doing

While you work, Studio paints your state on the element itself, so the user can see that something
is happening to *that* box without opening the run tray.

Studio only shows what it knows as fact: the run is **queued**, **working**, **done** or
**failed**. It does not guess between reading and editing from your tool names — those are your
harness' vocabulary and they change. Anything finer than "working" is yours to declare, by
printing this line at any point during the run:

```
<!-- hf:overlay {"kind":"editing","scope":"text","label":"Rewriting the headline"} -->
```

Studio reads it out of your normal output — stream-json or plain prose, whichever your harness
writes — and strips it back out of the run's activity line, so it costs the reader nothing. It is
a declaration, not a request: the last one you print wins, and it holds until you print another or
the run ends.

```ts
interface OverlayState {
  /** Yours to declare: reading | thinking | editing. Studio owns the other four. */
  kind: "queued" | "working" | "reading" | "thinking" | "editing" | "done" | "failed";
  /** What the work is about. Selects a finer treatment on the canvas. */
  scope?: "text" | "box" | "motion" | "content";
  /** One short line for the badge. Studio falls back to your latest output line. */
  label?: string;
  /** Any CSS colour, if this run wants its own. */
  accent?: string;
  /** Another element, when it is not the one the run targets. */
  target?: { selector?: string; id?: string };
}
```

What each one looks like on the canvas:

| State | The element shows |
| --- | --- |
| `queued` | Quiet, dimmed outline — waiting never looks like working. *(Studio's)* |
| `working` | The same sweep as an edit, with your latest output as the badge. *(Studio's, when you declare nothing)* |
| `reading` | Marching ants, slow and blue: under inspection, not being changed. |
| `thinking` | A dotted orb spinning fast; nothing else moves. |
| `editing` | A light travelling the outline, with a soft glow behind it. |
| `editing` + `scope: "text"` | A rule drawing itself under the copy, with a caret. The box is left alone. |
| `editing` + `scope: "box"` | The four corners breathe — border, radius, fill. |
| `editing` + `scope: "motion"` | A ghost outline drifts off the box: the animation is what moves. |
| `done` / `failed` | Outline goes solid green or red for a beat, then hands the canvas back. *(Studio's)* |

### How to use it well

- **Declare when the work changes shape**, not on a timer. One line before a long edit is worth
  more than five lines narrating a single write.
- **Scope is the whole point.** `{"kind":"editing"}` says little more than the working state does;
  `{"kind":"editing","scope":"motion","label":"Retiming the exit"}` tells them what to watch.
- **`target` moves the badge.** `{"kind":"reading","target":{"selector":".caption"}}` puts the state
  on the caption instead of the element the run was started from. Use it when you are looking at
  one element to change another.
- **Do not claim `done` or `failed`.** Those are Studio's to set when your process exits — a
  declared terminal state that is wrong outlives you.
- **`label` is a badge, not a sentence.** Under ~40 characters, sentence case, no trailing period.
- **Ignoring this costs nothing.** Queued, working, done and failed still show. An unrecognised
  `kind` falls back to the neutral working treatment rather than vanishing.

## TimelineSkeleton — say what you are about to add

The timeline can show what exists and what you are editing, but not what is *about to* exist. If
you spend a minute writing three new clips, the user watches an unchanged timeline until the file
lands. Say where they are going and Studio draws a skeleton at each spot for the rest of the run:

```
<!-- hf:timeline {"adding":[{"track":0,"start":1.0,"end":3.0,"label":"Hero card"}]} -->
```

**Print it before you start writing, not after.** A skeleton exists to fill the gap between "I
have decided where these go" and "the file has changed", so a declaration that arrives with your
final message has nothing left to cover: the run ends, the composition reloads, and the real clips
replace it in the same breath. Declare as soon as you know the times and tracks, then do the work.

Read the rest closely, because one field is easy to get wrong:

- **`track` is a `data-track-index`**, the number you write into the file. It is not a row number
  on screen. Studio packs authored tracks onto contiguous rows, so a composition using tracks 0, 4
  and 9 draws them as the first three rows. Give the number you are about to write and Studio does
  the translation.
- **A track with no clips yet is fine, and is the most useful case.** Declaring a track that does
  not exist draws a provisional row, which is how "I am adding a new track" becomes visible.
- **`start` and `end` are seconds**, and `end` must be after `start`.
- **`label` is optional**, and shows on the skeleton. Keep it to a few words.
- **`file` is optional**, and only needed when you are editing a composition other than the one on
  screen.

The same rules as the overlay marker apply: Studio reads it out of your normal output and strips it
from the activity line, and the last declaration wins. That last part matters more here, because
the declaration is the *whole* set. Declaring two clips and then one clip leaves one skeleton, not
three. `{"adding":[]}` is how you say you are no longer adding anything.

An entry Studio cannot read is dropped on its own, so one bad entry does not cost you the rest,
and a declaration it cannot parse at all leaves your previous one standing. Skeletons are cleared
when your run ends, whatever the outcome, so you never have to take them down.

Do not declare a skeleton for a clip you are moving, resizing or deleting. This says one thing:
here is a clip that does not exist yet and is about to.

## A request may already name a track

An edit request can arrive scoped to a single track, in which case the prompt says so explicitly
and names the `data-track-index`. When it does, that track is the answer to "where does this go":
put anything you add on it, and leave the other tracks alone.

## How Studio is talking to you

Two transports, and which one you are on changes what is possible — not what is expected of you.
The request format above and the OverlayState contract are identical either way.

- **Native.** Studio spawned your CLI and is reading your stdout. It learns what you did by parsing
  whatever you print, and it cannot answer a question, so a prompt for permission has nobody on the
  other end. Run under a permission mode that does not need to ask.
- **ACP.** Studio is speaking the [Agent Client Protocol](https://agentclientprotocol.com) to you.
  Tool calls, message chunks and your stop reason arrive as data rather than as text to be guessed
  at, and `session/request_permission` reaches a real person: the run parks, the tray shows your own
  options in your own words, and the answer comes back as the option id you offered. An
  unanswered request is declined with your own refusal option rather than allowed.

You do not choose the transport and you do not need to detect it. Say what you are doing with the
overlay marker, and it works on both.

## What else you can touch

- `<project>/.hyperframes/` holds Studio's own state. `agent-runs.jsonl` is the run history, one
  JSON object per line — readable, and useful when the user asks what happened earlier.
- The user's preview reloads on file change, so an edit is visible the moment it lands. There is no
  build step to run and no server to restart.
- Renders, lint and checks are the CLI's job, not Studio's: `npx hyperframes lint` and
  `npx hyperframes check` are the gates a composition has to pass. See `/hyperframes-cli`.

## Extending the overlay

Studio owns a registry that maps an `OverlayState` to a treatment, so a new state is an entry, not
a renderer change:

- `packages/studio/src/components/editor/overlayState.ts` — the vocabulary, the element-matching
  rules, and the four states Studio derives on its own. Nothing here classifies tool names, and
  nothing new should: a state Studio cannot know as fact belongs to the agent.
- `packages/studio/src/components/editor/AgentOverlayState.tsx` — `TREATMENTS`, keyed by `kind` and
  `kind:scope`. Add a key, add its glyph, done.
- `packages/studio/src/styles/studio.css` — the `hf-overlay-*` keyframes. Every treatment tints
  from `--hf-overlay-tint`, so a state that carries its own `accent` needs no rule of its own.
- `packages/studio-server/src/helpers/agentSchemas.ts` — `overlayStateSchema`, the one place the
  vocabulary is declared. Widen it there first or the parser drops the new value.

The timeline declaration has the same shape in a different set of files:

- `packages/studio-server/src/helpers/agentJobs.ts` — `readDeclaration` is shared by both markers,
  so a third one is a schema and a call, not another parser.
- `packages/studio/src/player/components/timelineAuthoredTrack.ts` — the authored-to-display
  translation both features depend on. Nothing outside it should do that arithmetic.
- `packages/studio/src/player/components/useTimelineSkeletons.ts` and `TimelineSkeletons.tsx` —
  what gets drawn, and where.

House rules the treatments hold to: one motion at a time, transform and opacity only, and every
animation collapses to a static coloured outline under `prefers-reduced-motion`.
