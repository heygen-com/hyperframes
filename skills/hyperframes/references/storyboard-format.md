# Storyboard format — `STORYBOARD.md` + parsed manifest

Defines the storyboard's **base data format** only: the `STORYBOARD.md` file shape and the `StoryboardManifest` it parses into. Planning the film itself is in [story.md](story.md); the optional narration/TTS file (`SCRIPT.md`) is a separate concern, not here.

A storyboard is the **plan layer** for a video — an ordered set of **frames** (key moments) in one markdown file. Parser: `@hyperframes/core/storyboard` → `StoryboardManifest`.

## Frontmatter (global direction)

YAML block at the top. Unknown keys are kept under `globals.extra`.

| Key        | Meaning                                                      | Example                                   |
| ---------- | ------------------------------------------------------------ | ----------------------------------------- |
| `format`   | Canvas size                                                  | `1920x1080`                               |
| `duration` | The length the person asked for (advisory, not a hard limit) | `22s`                                     |
| `message`  | One-line thesis                                              | `Ship a launch video in an afternoon`     |
| `arc`      | Narrative arc                                                | `Hook → Problem → Solution → Proof → CTA` |
| `audience` | Who it's for                                                 | `indie devs on X`                         |
| `mode`     | Interaction mode (default collaborative)                     | `autonomous`                              |

Set `duration` when the storyboard is first written. It is an expectation, not a gate: compare where the cut actually lands against it — judge whether the drift serves the piece, and update the value when the intended length genuinely changes.

## Per-frame sections

One `## Frame N — Title` heading per frame (`Frame` / `Beat` / `Scene` accepted at H2/H3). Metadata as `- key: value` bullets; everything below them until the next heading is the free-form **narrative**.

| Key             | Meaning                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------- |
| `status`        | `outline` → `built` → `animated` (defaults `outline`)                                                               |
| `src`           | project-relative path to the frame's HTML sub-composition (the tile poster renders from it)                         |
| `duration`      | e.g. `4s`                                                                                                           |
| `transition_in` | `crossfade` / `cut` / `wipe` … (alias `transition`); a note only, build it yourself (overlap clips for a crossfade) |
| `scene`         | one-line contact-sheet caption (aliases `description` / `summary` / `caption`)                                      |
| `voiceover`     | the frame's narration _guide_ (aliases `vo` / `voice_over` / `narration`)                                           |
| `poster`        | seconds to seek for the tile poster (past the intro animation)                                                      |
| _any other key_ | kept verbatim under the frame's `extra` — carry your own per-frame data (effects, assets, …) here                   |

Two `extra` keys every film plan carries, so the build and the review check the same thing:

| Key     | Meaning                                                                                                                                                                                                                          |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reads` | what the viewer must understand in this frame, in order, each with its window: `the cursor finds the button (0.4-1.2s); "Export" lands (1.2-2.6s)`. Windows never overlap, and each is long enough for its words (`story.md` §6) |
| `sound` | the bed, the effects on visible actions, or silence: `bed enters strong; click on Export; whoosh on the cut`                                                                                                                     |

## Parsed manifest

The parser is **lenient**: it never throws and records anything surprising as a `warning`.

```
StoryboardManifest {
  globals: { format?, message?, arc?, audience?, extra: {…} }
  frames: Array<{
    index, number?, title?,
    status,                       // "outline" | "built" | "animated"
    src?, duration? / durationSeconds?, transitionIn?,
    scene?, voiceover?, poster?,
    narrative,                    // markdown below the metadata
    extra: {…}                    // unknown keys, preserved
  }>
  warnings: Array<{ message, line?, frameIndex? }>
}
```

## `SCRIPT.md` (out of scope here)

Optional, free-form, **not parsed into the manifest** — the locked-narration file that drives TTS, absent for videos with no narration/TTS. The per-frame `voiceover` above is the storyboard's own narration guide.

## Example

```markdown
---
format: 1920x1080
message: "Ship a launch video in an afternoon"
arc: Hook → Problem → Solution → Proof → CTA
audience: indie devs on X
---

## Frame 1 — Hook

- scene: Big type punches in on the beat
- duration: 3s
- poster: 2s
- transition_in: cut
- status: animated
- voiceover: "Ship a launch video in an afternoon."
- reads: "Ship a launch video" lands (0.3-1.6s); "in an afternoon" (1.6-3.0s)
- sound: bed enters on its strongest bar; impact on "afternoon"
- src: compositions/frames/01-hook.html

Open cold on the promise. This is the thesis — everything after pays it off.

## Frame 2 — The problem

- scene: A 20-minute timer spins on a stack of rejected takes
- duration: 4s
- transition_in: crossfade
- status: built
- voiceover: "The old way? Prompt, wait twenty minutes, get something that misses."
- src: compositions/frames/02-problem.html

The old way: prompt, wait, get something that misses. Establish the pain we remove.
```

## Notes

- A frame with `status: outline` and no built `src` renders as an outline placeholder.
- `built` is the middle rung: the frame's HTML exists and its **layout is confirmed** (a wireframe sketch or better) — motion not yet added. Nothing is drawn yet beyond the approved layout.
- Multi-line `voiceover` values collapse to one line on save.
