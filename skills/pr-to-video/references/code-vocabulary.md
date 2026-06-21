# Code vocabulary — the `code-*` animation blocks

PR videos live on code. The registry ships purpose-built **code animation blocks** that render a diff, a typed-on snippet, a morph, a highlight, a scroll, or a 3D/particle/dissolve reveal — far better than hand-built motion. **Reach for one of these first** for any code beat; fall back to hand-authored composition only when none fits.

- **Step 4 (visual design):** for each `diff` / `before_after` / code beat, name the block in the frame's `scene` (e.g. "the `request()` retry block, ~6 lines, `code-diff`"). One judgment call: which block.
- **Step 5 (frame worker):** install the named block and fill it with the real diff/snippet (below). The block is the frame's centerpiece, composited onto claude's navy **Code Surface**.

## Install + use

Every block installs the same way (confirmed `packages/cli/src/commands/add.ts`):

```bash
npx hyperframes add <block-name>     # writes compositions/<block-name>.html
```

It is a self-contained sub-composition (inlined engine; a paused GSAP timeline the engine seeks per frame). Mount it in the frame as a sub-composition clip:

```html
<div
  data-composition-id="code-diff"
  data-composition-src="compositions/code-diff.html"
  data-start="0"
  data-duration="6"
  data-track-index="1"
  data-width="1920"
  data-height="1080"
></div>
```

**Customize by editing two globals** in the installed HTML's inline `<script>`:

- `window.__TOKENS` — the code content, baked as Shiki tokens: `{ <seq>: { lang, theme, bg, fg, states: [ { code, tokens:[ {key, content, color, fontStyle} ] } ] } }`. Replace `code`/`tokens` with the PR's real snippet(s). `fontStyle` is a bitmask (`&1` italic, `&2` bold). The blocks bake `theme: "github-dark"` independently of the `code-snippet-*` themes below.
- `window.__BLOCK` — selects the effect + timing: 2D `{ id, effect, seq, line?, duration }`; WebGL `{ id, effect, seq, duration, seed }`.

The timeline registers synchronously at `window.__timelines[id]`. All blocks are **1920×1080** and **deterministic / seek-safe** (no CSS transitions, no rAF, seeded randomness — never `Math.random` / `Date.now`).

## The animation blocks

| Block                        | What it does                                                                                                      | Inputs of note                                                                                        | PR beat                                                                                                                     |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **`code-diff`**              | Unified diff inside an editor window: removed lines collapse in red, added lines expand in green, staggered. (6s) | `__TOKENS.diff.states` needs **exactly 2 states** (before, after) — the engine LCS-diffs them.        | The diff hunk (before→after); literal add/remove semantics. **The default PR block.**                                       |
| **`code-morph`**             | One snippet transforms into another — shared tokens glide (FLIP), leavers fade out, enterers fade in. (7s)        | `__TOKENS.morph.states` (2+); reuse the same token `key` across states for a token that should glide. | A refactor / rename / signature change where continuity matters (not add/remove framing).                                   |
| **`code-typing`**            | Per-character typewriter reveal with a gliding caret. (5s)                                                        | single state in `__TOKENS.feature.states[0]`.                                                         | A new function / file **written on screen** ("here's what we added").                                                       |
| **`code-highlight`**         | A blue band sweeps one line; the rest dim. (5s)                                                                   | `__BLOCK.line` = target line, **0-based here**. single state.                                         | "This one line is the change" — spotlight a changed/important line. Quick callout.                                          |
| **`code-scroll`**            | "Camera" scrolls a long file to center a target line, dims the rest. (6s)                                         | `__BLOCK.line` = target, **1-based here**. one long state.                                            | Locating the change in a large file. The only block built for long files.                                                   |
| **`code-3d-extrude`**        | Code on a lit, beveled 3D slab that rotates and settles. (8s, WebGL)                                              | single state; `__BLOCK.seed`. `<canvas id="gl">`.                                                     | A hero / title code moment ("the feature"). Style over density — not for reading a diff.                                    |
| **`code-particle-assemble`** | GPU particles scatter, then fly to the exact glyph pixels and resolve to syntax color. (8s, WebGL)                | single state; `__BLOCK.seed`.                                                                         | A dramatic climax reveal of a key snippet. Flashiest; not for line-by-line reading.                                         |
| **`code-shader-dissolve`**   | Code "compiles into existence" out of seeded noise with a moving dissolve front + edge glow. (7s, WebGL)          | single state; `__BLOCK.seed`.                                                                         | A "compiles / builds / works now" beat, or a polished snippet reveal.                                                       |
| **`code-snippet-flight`**    | Discrete snippets fly in from the side and assemble into a stacked program (block-level FLIP). (6s)               | `__TOKENS.flight.states`.                                                                             | "The pieces assemble" — several functions/modules coming together. (An animation block despite the `code-snippet-` prefix.) |

**Gotchas (call out so the worker doesn't trip):**

- `code-diff` and `code-morph` need **≥2 baked states**; every other animation block uses a single state.
- **Line indexing differs:** `code-highlight` is **0-based** (`line: 1` = the 2nd line); `code-scroll` is **1-based**. Don't off-by-one.
- **No caption-safe band.** These are full-bleed 1920×1080 code surfaces with no reserved caption area. When captions are enabled, the frame must keep the code panel clear of the bottom caption keep-out band (composite the block in the top ~83%, or scale/inset it) — the worker owns that, not the block.

## The `code-snippet-*` theme family (standalone, not palettes)

These are **NOT palettes you attach to the animation blocks** — each is its own ready-made ~11–12s composition rendering a full developer UI with baked typing and its own timeline. Use one when you want **ambient realistic context** (a real IDE or terminal on screen), not a focused diff. Install the specific one: `npx hyperframes add code-snippet-<name>`.

- **VS Code workbench (12):** full VS Code window (activity bar, file-tree, tabs, editor with per-char typing, integrated terminal running `pytest`, status bar) in each theme. `dark-plus`, `light-plus`, `dark-modern`, `light-modern`, `dark-2026`, `light-2026`, `monokai`, `solarized-light`, `visual-studio-dark`, `visual-studio-light`, `high-contrast`, `high-contrast-light`. (Each pulls a `background.jpeg` into `assets/`.)
- **Apple Terminal (12):** macOS Terminal.app window typing a shell command per profile. `apple-terminal-` + `basic`, `clear-dark`, `clear-light`, `grass`, `homebrew`, `man-page`, `novel`, `ocean`, `pro`, `red-sands`, `silver-aerogel`, `solid-colors`.

The theme is baked into each block (not chosen at runtime); to use a given look, install that block and edit its `codeLines`. For claude's editorial register, prefer the focused animation blocks on the navy Code Surface; reach for a `code-snippet-*` UI only when "show it in a real editor/terminal" is the point.

## PR beat → block cheat-sheet

| PR moment                                               | Block(s)                                                                                                                                 |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Diff hunk (before → after)                              | `code-diff`                                                                                                                              |
| Refactor / rename / signature change (continuity)       | `code-morph`                                                                                                                             |
| Failing → passing test (red → green)                    | `code-morph` or `code-diff` + `code-highlight` on the green line; a `code-snippet-*` VS Code/terminal block for a literal test-runner UI |
| New function / file typed on                            | `code-typing`                                                                                                                            |
| Spotlight one changed line                              | `code-highlight`                                                                                                                         |
| Walk / scroll a long changed file                       | `code-scroll`                                                                                                                            |
| Pieces / modules assembling into a feature              | `code-snippet-flight`                                                                                                                    |
| Hero / title code moment ("the feature")                | `code-3d-extrude`                                                                                                                        |
| "Compiles / builds / works now" reveal                  | `code-shader-dissolve`                                                                                                                   |
| Big dramatic snippet reveal / climax                    | `code-particle-assemble`                                                                                                                 |
| A benchmark / metric / count-up                         | **Not a `code-*` block** — use claude's `number-lockup` (Number/Impact treatment) or the `data-chart` registry block                     |
| Show the change in a realistic IDE / terminal (ambient) | a `code-snippet-*` VS Code theme (editor) or Apple Terminal profile (CLI run)                                                            |
