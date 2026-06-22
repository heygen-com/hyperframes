# Storyboard format — `STORYBOARD.md` + parsed manifest

Defines the storyboard's **base data format** only: the `STORYBOARD.md` file shape and the `StoryboardManifest` it parses into. How a workflow _generates_ a storyboard lives in that workflow; the optional narration/TTS file (`SCRIPT.md`) is a separate concern owned by the TTS step, not here.

A storyboard is the **plan layer** for a video — an ordered set of **frames** (key moments) in one markdown file. HyperFrames Studio renders it as a contact sheet (the Storyboard view, behind `VITE_STUDIO_ENABLE_STORYBOARD=1`). Parser: `@hyperframes/core/storyboard` → `StoryboardManifest`; read API: `GET /api/projects/<id>/storyboard`.

## Frontmatter (global direction)

YAML block at the top. Unknown keys are kept under `globals.extra`.

| Key        | Meaning         | Example                                   |
| ---------- | --------------- | ----------------------------------------- |
| `format`   | Canvas size     | `1920x1080`                               |
| `message`  | One-line thesis | `Ship a launch video in an afternoon`     |
| `arc`      | Narrative arc   | `Hook → Problem → Solution → Proof → CTA` |
| `audience` | Who it's for    | `indie devs on X`                         |

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
- Multi-line `voiceover` values collapse to one line on save.
