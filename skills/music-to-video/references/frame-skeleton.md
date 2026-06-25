# Frame skeleton (Step 2) — read the music, lay out the frames

At Step 2 **you (the orchestrator)** read `audiomap.json` and write the **skeleton** of
`STORYBOARD.md` directly: cut the track into **frames** (one frame = one composition file =
one scene), and for each frame set its **span**, its **pacing** (does this stretch want hard
beat-cuts, or calm phrase/energy flow?), its **mood**, and a one-line **feel** note.

You **classify and lay out the spine only.** You do **not** pick templates, write copy, choose
colors/fonts, or decide a frame's groups — those are Step 3 (the plan fills each frame in
place). Leave every frame's `### Groups` as `TBD (Step 3)` and the frontmatter `style` blank.

There is **no intermediate JSON** — the skeleton _is_ the start of `STORYBOARD.md`. Step 3
edits the same file.

## The trust boundary (read this first)

`audiomap.json` is one analyzer's output. Some fields are robust on **any** music; some are
reliable only when the music is **actually rhythmic**. This decides each frame's `pacing`:

| Field                                                                                                                                                                                               | Trust                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `energy_phases[]` (level / energy / density / feel), `events[]` + `onset_rate`, `rolls[]` (and their **absence**), `silences[]`, `hard_stops[]`, `key_moments[]`, `phrases[]`, `audio.duration_sec` | **Always** — robust measurements                                                                                                                                                                                             |
| `tempo.bpm`, `grid.beats_sec` / `downbeats_sec` **precision**                                                                                                                                       | **Only when the music is rhythmic.** On calm / sparse material the beat grid is a metronome the tracker _imposes_ (often octave-doubled) — usually **more grid beats than real onsets**. Do **not** anchor cuts to it there. |

- **Grid is reliable** when: rolls present, and/or dense phases, and/or high `onset_rate` with a steady grid.
- **Grid is fictional** when: `rolls`≈0, mostly `sparse` phases, low `onset_rate` → pace by `phrases[]` + `energy_phases[]`, not beats.

## How to lay out frames (run in order)

1. **Gestalt.** From `summary` / `tempo` / `audio.duration_sec` + the roll count, write the
   frontmatter `compositionId`, `duration_s` (== `audio.duration_sec`), `canvas`, and a
   one-line read of the track's density arc.
2. **Cut into frames.** Walk `energy_phases[]` and split where the music genuinely changes
   state — at `hard_stops[]`, `SURGE` / `DROP` `key_moments`, the start/end of a `rolls[]` run,
   an **onset desert** (a long gap in `events[]`), or a big energy-level jump. Collapse adjacent
   phases that are one gesture. Expect **~1–6 frames**; a short clip may be one.
   **Snap every boundary to an audiomap anchor**, then re-snap to the nearest `beats_sec`
   (tolerance ≤ ½ beat) **only when the grid is reliable**; on calm material snap to
   `phrases[]` / `energy_phases[]` edges instead. Frames **tile the track** (first at 0, last
   at `duration_s`, no gaps/overlaps).
3. **Per frame, set `pacing`** — the trust-boundary call:
   - **`beat_cut`** — genuinely rhythmic: a roll present, **or** dense, **or** (clearly high `onset_rate` **and** a steady grid). Hard cuts / per-onset reveals may anchor to beats.
   - **`phrase_flow`** — calm / sparse: `rolls`≈0, mostly sparse, low `onset_rate`. Do **not** anchor hard cuts to the grid; pace by `phrases[]` + the energy envelope (slow crossfades, long holds).
4. **Per frame, tag `mood`** (1–3 of: `warm` · `dark` · `hype` · `elegant` · `glitch` ·
   `cinematic` · `playful` · `tense` · `dreamy` · `aggressive`) from `energy_phases[].feel` +
   energy + any genre cue in the brief/title.
5. **Per frame, write a one-line `feel`** — the plain-language music situation Step 3 matches a
   template against (e.g. "accelerating onset stream into a held downbeat", "calm held pad, one
   onset desert", "fast sustained-fill roll, no readable message"). This is what the planner
   reads against the catalog's **Reach for it when** — keep it concrete, drawn from the robust
   fields, never invented.

## What the skeleton looks like

A valid `STORYBOARD.md` with the spine set and every frame's treatment left for Step 3
(full syntax in [`storyboard-format.md`](storyboard-format.md)):

```markdown
---
compositionId: bgm
duration_s: 30.0 # == audiomap.audio.duration_sec
canvas: { w: 1920, h: 1080, fps: 30 }
style: # blank — Step 3 fills it from the chosen frame.md preset
build_notes: ["one paused timeline per frame", "no remote assets"]
---

## Frame 1 — f1

- src: compositions/frames/01-f1.html
- duration: 7.198s # = span length; assembler sums these for cumulative data-start
- span_sec: [0.0, 7.198] # track seconds; frames tile the track
- pacing: beat_cut
- mood: [hype]
- feel: accelerating onset stream building into a held downbeat

### Groups

- TBD (Step 3)

## Frame 2 — f2

- src: compositions/frames/02-f2.html
- duration: 10.4s
- span_sec: [7.198, 17.598]
- pacing: phrase_flow
- mood: [warm, cinematic]
- feel: calm held pad, one long onset desert

### Groups

- TBD (Step 3)
```

## Self-check

- `duration_s == audiomap.audio.duration_sec`; frames tile the track gap-free (first at 0, last at `duration_s`).
- Every frame has `src` + `span_sec` + `duration` + `pacing` + `mood` + a one-line `feel`.
- `pacing` was set from the **robust** fields (energy / density / rolls / onset_rate), never from `bpm` / `beats_sec` alone.
- No frame boundary sits inside a `rolls[]` run or leaves a sub-1-bar fragment.
- Every frame's `### Groups` is `TBD (Step 3)`; `style` is blank. **No template, copy, color, or font anywhere.**
