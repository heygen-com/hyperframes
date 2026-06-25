# STORYBOARD.md format — frames → groups

`STORYBOARD.md` is the single reviewable plan the user approves at Step 3 and the **manual**
each frame-worker follows at Step 4. It is **hierarchical**: one block per **frame**, written
as a `## Frame N — <frame_id>` heading (the parser recognizes `Frame`). **One frame = one
scene = one composition file.** Inside each frame block are its **groups** (the treatment
units). The assembler reads the frame level (`duration` → `data-start`, `src`); the worker
reads its own frame block. A frame's **composition id = its `src` file stem**
(`compositions/frames/01-f1.html` → `01-f1`), which the worker uses as `data-composition-id`
and the `window.__timelines` key.

Step 2 writes the skeleton (frame fields, groups `TBD`); Step 3 fills the groups + brand. It
is a build spec, not code — the planner writes WHAT, the worker decides HOW. **Never write
millisecond tweens here.**

## File shape

YAML frontmatter (the video-wide spine) + one `## Frame N — <frame_id>` block per frame.

```markdown
---
compositionId: bgm
duration_s: 30.0 # == audiomap.audio.duration_sec, exactly
canvas: { w: 1920, h: 1080, fps: 30 }
style: # brand spine — from the chosen frame.md preset (Step 3)
  font: "EB Garamond / Inter / JetBrains Mono" # the preset's typography, verbatim
  palette: ["#FAF9F5", "#141413", "#CC785C", "#181715"] # ≤4–6 swatches from the preset's colors
assets: false # false, or a note like "assets/ has 6 user photos"
build_notes: ["one paused timeline per frame", "no remote assets"]
avoid: ["generic slideshow", "tiny unreadable hero text"]
---

## Frame 1 — f1

- src: compositions/frames/01-f1.html # worker writes here; assembler refs it; stem (01-f1) = composition id
- duration: 7.198s # = span length; the assembler reads this for cumulative data-start
- span_sec: [0.0, 7.198] # track seconds; frames tile the track
- pacing: beat_cut # beat_cut | phrase_flow (from the skeleton; obey it)
- mood: [hype]
- feel: accelerating onset stream into a held downbeat

### Groups

- **g1** — template: `intro-kinetic-cascade`
  - span_sec: [0.0, 4.017] # frame-LOCAL build is 0-based; these are TRACK seconds (worker subtracts frame start)
  - params: { theme: "light", icon: "bolt", phrases: "[…]", climax: "{…}" }
  - role_bindings: { phrase: { times: [0.14, 0.55, 0.87] }, climax: { in: 3.79, iconAt: 4.9 } }
  - copy: "GROWTH THROUGH CREATIVITY"
- **g2** — free_design
  - span_sec: [4.017, 7.198]
  - free_design: { dominant_system: "per-onset typography", primitives: ["content-swap", "braam-punch"], density_topology: "accumulate" }
  - anchors: [4.10, 4.80, 5.50, 6.20] # onset seconds the reveals ride (from audiomap)
  - copy: ["BUILD", "SHIP", "REPEAT"]

## Frame 2 — f2

…
```

## Frame block — required fields

| field                             | meaning                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| heading `## Frame N — <frame_id>` | `frame_id` matches the `src` stem; `N` = the 1-based index.                                                                    |
| `src`                             | `compositions/frames/NN-<frame_id>.html` — where the worker writes; the assembler references it. Stem = `data-composition-id`. |
| `duration`                        | the frame span length in seconds (e.g. `7.198s`) — **required**; the assembler sums these for cumulative `data-start`.         |
| `span_sec`                        | `[start, end]` track seconds. `duration = end − start`.                                                                        |
| `pacing`                          | `beat_cut` \| `phrase_flow` — from the skeleton; the worker must obey (no hard-cut on `phrase_flow`).                          |
| `mood`, `feel`                    | from the skeleton; tone + the one-line music situation the planner matched against.                                            |
| `### Groups` list                 | ≥1 group; groups tile the frame span in order.                                                                                 |

## Group entry — exactly one of three kinds

Every group is **template** OR **free_design** OR **asset** — never two, never none. All three
carry `span_sec` (track seconds, tiling the frame) and may carry `copy`.

- **template** — `template: <catalog id>` + `params` (keys from the catalog entry) + `role_bindings` (real audiomap anchor seconds) + `copy`.
- **free_design** — `free_design: { dominant_system, primitives: [catalog ids], density_topology }` + `anchors` (real beat / onset seconds) + `copy`.
- **asset** — `asset: { treatment, clips: [public/…], anchors?, overlay_copy? }`. `treatment` ∈ `beat_cut` (one clip per anchor — only on a `beat_cut` frame) | `ken_burns` (slow push — fits `phrase_flow`) | `bg_under_text` (clip dimmed behind a template / free group). See [`montage.md`](montage.md).

## Rules

- Frames tile the track (gap-free, first at 0, last at `duration_s`); a frame's groups tile its span; no group < ~1 bar; no group boundary inside a `rolls[]` run.
- `params` keys come from the template's [`template-catalog.md`](template-catalog.md) entry.
- All anchor seconds are **track seconds from `audiomap.json`** — the worker converts to frame-local by subtracting the frame start.
- A `phrase_flow` frame MUST NOT use `beat_cut` asset treatment or per-onset hard cuts.
- The brand `style` is set once; every group's palette draws from it.
- Reviewable prose-plus-data; keep it scannable. No GSAP, no millisecond timing.

## Self-check (the planner runs `validate-plan.mjs`)

- frontmatter has `compositionId`, `duration_s` (== audiomap), `canvas`, `style`.
- every frame has `span_sec` + `src` + positive `duration` + `pacing` + ≥1 group; frames tile the track.
- every group is exactly one of template / free_design / asset; template ids exist in the catalog; anchors are real audiomap seconds; `phrase_flow` frames have no `beat_cut`.
