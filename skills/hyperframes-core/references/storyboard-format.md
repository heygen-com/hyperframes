# Storyboard format — `STORYBOARD.md` + parsed manifest

Defines the storyboard's **base data format** only: the `STORYBOARD.md` file shape and the `StoryboardManifest` it parses into. How a workflow _generates_ a storyboard lives in that workflow; the optional narration/TTS file (`SCRIPT.md`) is a separate concern owned by the TTS step, not here.

A storyboard is the **plan layer** for a video — an ordered set of **frames** (key moments) in one markdown file. HyperFrames Studio renders it as a contact sheet (the Storyboard view, available by default in every Studio session). Parser: `@hyperframes/core/storyboard` → `StoryboardManifest`; read API: `GET /api/projects/<id>/storyboard`.

## Frontmatter (global direction)

YAML block at the top. Unknown keys are kept under `globals.extra`.

| Key        | Meaning                                                           | Example                                   |
| ---------- | ----------------------------------------------------------------- | ----------------------------------------- |
| `format`   | Canvas size                                                       | `1920x1080`                               |
| `duration` | The brief's rough length expectation (advisory, not a hard limit) | `22s`                                     |
| `message`  | One-line thesis                                                   | `Ship a launch video in an afternoon`     |
| `arc`      | Narrative arc                                                     | `Hook → Problem → Solution → Proof → CTA` |
| `audience` | Who it's for                                                      | `indie devs on X`                         |
| `mode`     | Interaction mode (see `brief-contract.md`; default collaborative) | `autonomous`                              |

Set `duration` from the brief's `length` when the storyboard is first written. It is an expectation, not a gate: assembly reports where the cut actually lands against it and flags a large gap — judge whether the drift serves the piece, and update the value when the intended length genuinely changes.

## Per-frame sections

One `## Frame N — Title` heading per frame (`Frame` / `Beat` / `Scene` accepted at H2/H3). Metadata as `- key: value` bullets; everything below them until the next heading is the free-form **narrative**.

| Key             | Meaning                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------- |
| `status`        | `outline` → `built` → `animated` (defaults `outline`)                                                         |
| `src`           | project-relative path to the frame's HTML sub-composition (the tile poster renders from it)                   |
| `duration`      | e.g. `4s`                                                                                                     |
| `transition_in` | `crossfade` / `cut` / `wipe` … (alias `transition`)                                                           |
| `scene`         | one-line contact-sheet caption (aliases `description` / `summary` / `caption`)                                |
| `voiceover`     | the frame's narration _guide_ (aliases `vo` / `voice_over` / `narration`)                                     |
| `poster`        | seconds to seek for the tile poster (past the intro animation)                                                |
| _any other key_ | kept verbatim under the frame's `extra` — a workflow carries its own per-frame data (effects, assets, …) here |

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

The read API also adds `srcExists` per frame and attaches the optional `SCRIPT.md` payload when present.

## `SCRIPT.md` (out of scope here)

Optional, free-form, **not parsed into the manifest** — the locked-narration file that drives TTS. Its format is defined in `references/script-format.md`, and it is absent for videos with no narration/TTS. The per-frame `voiceover` above is the storyboard's own narration guide.

## Frame comments — `.hyperframes/frame-comments.json`

The storyboard review's **structured feedback channel** — the file Studio's per-frame comment boxes write on submit (chat feedback follows the same rule — `brief-contract.md` § 1, the comments channel). Like `SCRIPT.md`, it is a sibling of the storyboard, not parsed into the manifest.

```json
{
  "version": 1,
  "pass": "sketch",
  "submitted_at": "2026-07-09T12:04:00Z",
  "comments": [
    {
      "frame": 3,
      "src": "compositions/frames/03-mechanism.html",
      "title": "Mechanism",
      "text": "Swap the bar chart for a before/after slider."
    }
  ]
}
```

| Field                    | Meaning                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `pass`                   | which review the batch belongs to: `storyboard` (text layer) / `sketch` (static frames) / `final` (assembled video) |
| `comments[].frame`       | the frame's 1-based `index` in the manifest — the key                                                               |
| `comments[].src` `title` | copied from the frame at submit time — if frames get reordered after submit, the mismatch shows                     |
| `comments[].text`        | the feedback, verbatim                                                                                              |

Lifecycle — the whole contract: a workflow finding this file at a checkpoint treats it as the revision feedback — **revise exactly the frames named, delete the file, re-present**. Writers create it only on submit; it never lingers across rounds.

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
- `built` is the middle rung: the frame's HTML exists and its **layout is confirmed** (a wireframe sketch or better) — motion not yet added. Studio chips it blue.
- The process that walks these statuses — plan, sketch, build, each pass reviewed on the board — is `review-loop.md`.
- Multi-line `voiceover` values collapse to one line on save.
