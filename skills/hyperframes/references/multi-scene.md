# Multi-Scene Build Pipeline

For compositions with 2 or more scenes, build in phases instead of one pass. A single pass produces shallow results — detail drops as context fills with boilerplate, and the authoring agent tends to under-decorate later scenes. Giving each scene its own subagent keeps per-scene density and decoration consistent.

Single-pass is reserved for true one-scene compositions: title cards, standalone overlays, single-clip animations.

## Who runs this pipeline

The parallel dispatch in Phase 1 and Phase 2b requires the `Agent`/`Task` tool. In Claude Code, only the **top-level conversation agent** (the one that received the user's `/hyperframes` invocation) has this tool. Dispatched subagents typically do not.

- **If you're the top-level agent:** run the full pipeline. Fan out scene subagents and evaluator subagents in parallel.
- **If you're a nested subagent** (you were dispatched with a `/hyperframes` task): you cannot fan out further. Author all scene fragments sequentially yourself, strictly following the Scene Fragment Spec below, then run the assembler and lint gates. Do not silently skip the pipeline — note in your final report that parallel dispatch was unavailable and you built serially.

The assembler, scaffold markers, fragment spec, and gates are the same either way; only the dispatch shape changes.

## Scene Fragment Spec

Every scene file (`.hyperframes/scenes/sceneN.html`) must be a **fragment**, not a standalone document. The assembler splits on markers and injects verbatim — non-compliant files break assembly.

### Structure

Exactly three sections, in this order, each appearing exactly once:

```
<!-- HTML -->
<div class="s3-heading">...</div>
...

<!-- CSS -->
.s3-heading { color: var(--fg); ... }
...

<!-- GSAP -->
var S3 = 14.3;
tl.set('#s3-heading', { opacity: 0, y: 30 }, 0);
tl.to('#s3-heading', { opacity: 1, y: 0, duration: 0.4 }, S3 + 0.5);
...
```

### Required

- **Three markers, one each:** `<!-- HTML -->`, `<!-- CSS -->`, `<!-- GSAP -->` — no duplicates
- **ID prefix:** All IDs and classes use `s{N}-` prefix (e.g., `#s3-heading`, `.s7-chart`)
- **GSAP pattern:** `tl.set()` at time 0 for initial state, `tl.to()` at scene time for animation
- **Scene start var:** Define `var SN = {start_time};` at top of GSAP section, reference it for all tweens
- **Finite repeats:** All `repeat` values must be explicit numbers, never `-1` or `Infinity`

### Prohibited

- `<!DOCTYPE`, `<html`, `<head`, `<body` — this is a fragment, not a document
- `<style>` or `</style>` tags — the CSS section is raw CSS, not wrapped in style tags. The scaffold's `<style>` block receives the content directly. Nested style tags break rendering.
- `<script>` or `</script>` tags — the GSAP section is raw JS, not wrapped in script tags. The scaffold's single `<script>` block receives the content directly. Nested script tags cause `Unexpected token '<'` parse errors.
- `<script src=` — no external script loading
- `gsap.timeline(` — the scaffold creates the timeline
- `window.__timelines` — the scaffold registers it
- `tl.from(` or `tl.fromTo(` — causes flash-of-default-state (use `tl.set` + `tl.to`)
- `body {` in CSS — the scaffold owns body styles
- `.scene {` in CSS — the scaffold owns scene base styles
- `position`, `top`, `left`, `width`, `height`, `opacity`, or `z-index` on `#sceneN` — the scaffold owns the scene container; only style elements INSIDE the scene
- Bare class names without `s{N}-` prefix (`.heading`, `.card`, `.tendril`, `.crack`) — causes cross-scene collisions when two scenes use the same name
- CSS `transform` for centering (`translate(-50%, -50%)`) on elements that GSAP animates — GSAP overwrites the entire `transform` property, destroying the CSS centering. Use GSAP `xPercent: -50, yPercent: -50` in the `tl.set()` at time 0 instead.

### Contrast

All text elements must achieve **4.5:1 contrast ratio** (WCAG AA) against their scene background. Check especially:

- HUD labels, stats, and values against dark backgrounds
- Light-colored text on tinted/colored backgrounds
- Small text (under 24px) has no large-text exemption

Use the design.md foreground color for text. If an element needs a different color for visual effect, verify contrast manually.

### Assembly contract

If a scene file follows this spec, the assembler can:

1. Split on `<!-- HTML -->`, `<!-- CSS -->`, `<!-- GSAP -->` markers
2. Inject HTML between the scaffold's `<div id="sceneN" class="scene">` and `</div>`
3. Append CSS to the scaffold's `<style>` block
4. Append GSAP into the scaffold's `<script>` after transitions, before `window.__timelines` registration

No parsing, no stripping, no guessing.

## Phase 1: Scaffold + Scene subagents (parallel)

The scaffold and scene subagents have no dependency on each other — dispatch them all at the same time. Scene subagents don't read the scaffold; they only need the fragment spec, design.md, and their scene prompt section. Assembly waits for both to finish.

**Nested-subagent fallback:** If you don't have the dispatch tool (see "Who runs this pipeline" above), write the scaffold first, then write each scene fragment yourself one after another. Skip Phase 2b streaming evaluation — the assembler's format validation (Phase 3) is your gate instead. Note the constraint in your final report.

### Scaffold

Build the HTML skeleton yourself (or in a subagent):

- All scene `<div>` elements with `data-start`, `data-duration`, `data-track-index`
- The root composition container with `data-composition-id`, `data-width`, `data-height`
- The GSAP timeline backbone: `gsap.timeline({ paused: true })`, `window.__timelines` registration
- All transition code between scenes (read [transitions.md](transitions.md))
- Global CSS: body reset, scene positioning, font declarations, the `design.md` palette as CSS
- Leave each scene's inner content empty: `<div id="scene1" class="scene"><!-- SCENE 1 CONTENT --></div>`
- **Visibility kills for every scene** including the last — after each scene's exit transition, add `tl.set("#sceneN", { visibility: "hidden" }, exitEndTime)`. The final scene needs this too (after its fade-out), or it remains partially visible when scrubbing.
- **Assembly markers** — the scaffold must include these exact comments so the assembler knows where to inject:
  - `/* SCENE STYLES */` inside the `<style>` block — scene CSS goes here
  - `// SCENE TWEENS` inside the `<script>` block, after transitions, before `window.__timelines` registration — scene GSAP goes here
  - `<!-- SCENE N CONTENT -->` inside each empty scene div — scene HTML goes here

### Scene subagents

Dispatch one subagent per scene, running in parallel (concurrently with the scaffold). Each subagent receives:

- The **Scene Fragment Spec** (above) — the subagent must follow this exactly
- The `design.md` (or its values summarized)
- The global animation rules from the prompt
- That scene's specific prompt section only
- The scene number `N` and start time — used for the `s{N}-` prefix and `var SN = {start_time};`
- **The persistent-subject choreography block for this scene**, if any — see below

Each subagent focuses its entire context on making ONE scene visually rich: parallax layers, micro-animations, kinetic typography, ambient motion, background decoratives. No boilerplate, no other scenes. **Each subagent must write to a file** — text returned in conversation is not accessible to the assembly agent.

### Persistent-subject choreography contract

If the expansion identified a persistent subject (R4 applies), the expansion will have produced a choreography plan with one block per scene. See [`prompt-expansion.md` → Pre-plan the persistent-subject choreography](./prompt-expansion.md).

When dispatching scene subagents, **the orchestrator must pass each subagent its scene's choreography block** along with these instructions:

1. **The persistent subject lives in a shared overlay layer outside your scene container.** Do NOT author the subject inside your scene fragment. The scaffold owns the subject's DOM + timeline.
2. **Your scene's layout must respect the reserved region.** No typography, no decoratives, no scene chrome may be placed inside the reserved region specified for your scene. The subject will occupy it.
3. **Design your scene's content around the element's role in this scene.** If the role is _focal subject_, your scene chrome is thin margins and light labels around it. If _background anchor_, your chrome fills the frame and the subject is a small corner anchor. If _data-point in a row_, your scene includes the row structure and reserves a slot for the subject.
4. **Do NOT animate the persistent subject in your GSAP timeline.** The scaffold authors the subject's tweens across scene boundaries on the `tl` timeline. Your scene tweens animate the scene's own content only.
5. **Your scene may reference the subject's position as a fixed anchor** — e.g., "the label line points at the subject's center at {x, y}." Treat it like a pre-placed element the scaffold will render for you.

The scaffold's responsibility:

1. Create the subject's DOM in the shared overlay layer outside `.scene` containers.
2. Author tweens on the subject that move it between choreography positions across scene boundaries — the transitions' timing determines when the subject starts its move.
3. Use `xPercent: -50, yPercent: -50` on the subject so position coords are center coords.
4. Coordinate scene crossfades with subject moves so the subject's motion spans the crossfade midpoint (so the viewer tracks one element through the cut).

Without this contract: scene subagents place their content where they think looks good, then the scaffold animates the subject into a region that was already filled — producing the size-collision and semantic-mismatch failures observed in prior evals.

## Phase 2b: Streaming evaluation

As each scene file appears in `.hyperframes/scenes/`, dispatch an evaluator subagent immediately — don't wait for all scenes to finish. The evaluator receives:

- The scene file
- The **Scene Fragment Spec** (above)
- That scene's section from the original prompt
- The `design.md`

### Evaluation order: format first, then content

**Step 1 — Format validation (instant FAIL if any check fails):**

- Exactly 3 markers (`<!-- HTML -->`, `<!-- CSS -->`, `<!-- GSAP -->`), each appearing once
- No prohibited patterns (DOCTYPE, html/head/body tags, `<script>`/`</script>` tags, script src, gsap.timeline, window.\_\_timelines, tl.from, body/scene CSS rules, CSS `transform` on GSAP-animated elements)
- All IDs and classes use `s{N}-` prefix
- No position/top/left/width/height/opacity/z-index on `#sceneN` in CSS
- All `repeat` values are finite numbers

**Step 2 — Content validation (only if format passes):**

- **Prompt adherence**: Does the scene include the elements the prompt described? List what's present and what's missing.
- **Design compliance**: Are the design.md colors, fonts, corners, and spacing used? Any invented values?
- **Contrast**: All text elements meet 4.5:1 against the scene background color. Check HUD labels, stats, and small text especially.
- **Density**: 15+ animated elements? 3 parallax layers?

The evaluator writes a verdict to `.hyperframes/scenes/sceneN.eval.md`: PASS or FAIL with specific issues. If FAIL, re-dispatch the scene subagent with the evaluator's feedback appended to the original instructions. Maximum 2 retries per scene — if a scene fails 3 times, escalate to the user with the evaluator's feedback and ask how to proceed. If PASS, the scene is ready for assembly.

Run evaluators concurrently with scene builds — a scene that finishes first gets evaluated first. The pipeline streams, not batches.

## Phase 3: Assembly

Once all scenes have PASS evaluations, run the deterministic assembler — do NOT hand-stitch scenes manually:

```ts
const { assembleScenes } = await import("@hyperframes/core/assemble");
const result = assembleScenes("./project-dir");
if (!result.ok) {
  // result.errors has file + message for each issue
}
```

The assembler validates every fragment against the spec, splits on markers, injects into the scaffold's marked slots, and verifies div balance. If any fragment fails validation, it aborts with specific errors — fix the fragment and re-run.

After assembly succeeds:

1. Run `npx hyperframes lint` and fix any structural issues
2. Run `npx hyperframes validate` if available
3. **Review the output** — read through the assembled file checking that scene HTML, CSS, and GSAP look correct before serving
