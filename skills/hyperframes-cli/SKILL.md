---
name: hyperframes-cli
description: >
  Use the HyperFrames CLI development loop: init, add, catalog, capture, lint, check, snapshot,
  compare, grade-compare, preview, play, present, beats, keyframes, single or batch render, publish,
  cloud, cloudrun, feedback, lambda, doctor, browser, info, upgrade, skills, compositions, docs,
  benchmark, telemetry, transcribe, auth, tts, and remove-background. Also use when diagnosing build
  or render failures. validate, inspect, and layout are deprecated aliases; use check. Covers local,
  HeyGen-hosted cloud, AWS Lambda, and Google Cloud Run rendering.
---

# HyperFrames CLI

Run commands as `npx hyperframes ...` unless project instructions provide a wrapper. Obey the wrapper when present. The CLI requires Node.js 22 or newer and FFmpeg.

## Development loop

1. **Scaffold:** `npx hyperframes init <project>` or capture a site. In non-TTY mode, pass `--non-interactive --example=<name>`.
2. **Author:** write the composition using `/hyperframes-core`.
3. **Get fast feedback while editing:** run `npx hyperframes lint` after the first HTML pass and after structural changes.
4. **Run the final gate:** run `npx hyperframes check`; it reruns lint before opening the browser. Do not prepend a redundant standalone lint invocation. Add `--snapshots` for annotated overview frames and finding crops.
5. **Inspect sub-compositions:** when `index.html` mounts `data-composition-src`, capture midpoint snapshots and inspect each mounted scene.
6. **Open the final Studio preview:** run `npx hyperframes preview`, hand the timeline project URL to the user, and ask whether to revise or render.
7. **Render only after approval:** use draft quality for iteration and high quality for delivery.
8. **Verify the output:** confirm the file exists, is non-empty, and has a plausible duration.

```bash
# Fast iteration check; repeat while authoring as needed.
npx hyperframes lint

# Required final gate; includes lint.
npx hyperframes check
npx hyperframes preview
npx hyperframes render --quality high --output out.mp4
test -s out.mp4
ffprobe -v error -show_format out.mp4
```

`check` runs lint first, then uses one browser session and one seek pass to audit runtime errors, failed requests, layout, `*.motion.json` assertions, and WCAG contrast. Persistent findings gate the exit code; transient entrance or exit findings are informational. Use `--strict` to gate warnings. `validate`, `inspect`, and `layout` remain aliases for compatibility but must not appear in new instructions or scripts.

## Two different preview surfaces

Do not confuse these states:

| Surface                   | When it may open                                       | Purpose                                                                           |
| ------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Storyboard board          | Before composition checks, only when `storyboard: yes` | Review plan cards and wireframe sketches. Open `?view=storyboard#project/<name>`. |
| Final composition preview | After `check` passes                                   | Review the assembled timeline before render. Open `#project/<name>`.              |

The early board is not approval of the final video. Rendering always requires the final approval defined by `hyperframes-core/references/review-loop.md`.

## Sub-composition smoke test

Static audits cannot catch every mount failure. When the project uses sub-compositions, capture at least one visible midpoint for each host slot:

```bash
npx hyperframes snapshot --at <t1>,<t2>,<t3>
```

Treat tiny unstyled content, canvas-sized icons, missing hero elements, or timeline-registration timeouts as render-blocking mount defects. See `hyperframes-core/references/sub-compositions.md` for the corresponding fixes.

## Agent conventions

- Prefer `--json` for agent and CI calls. Server-mode `render`, `preview`, and `play` do not provide ordinary JSON output; `preview --selection --json` and `preview --context --json` are query-mode exceptions.
- `doctor --json` always exits zero. Gate on its payload:

  ```bash
  npx hyperframes doctor --json | jq -e '.ok' >/dev/null
  ```

- Non-TTY mode is automatic. `init` requires `--example` there; use `--non-interactive` to force deterministic behavior on a TTY.
- Use one `HYPERFRAMES_RUN_ID` for all commands in the same verification loop.
- Use `--strict`, `--strict-all`, and `--strict-variables` when the corresponding warnings, variables, or CI conditions must gate the render.
- JSON paths redact the home directory as `$HOME`; do not try to reverse the redaction.
- Never render merely because checks pass. Pause at the final preview and wait for approval.

## Studio-directed edits

When the user refers to “this element” or the current selection, query Studio instead of guessing:

```bash
npx hyperframes preview --context --json --context-fields selection
```

Use `selection.target.hfId` when available, otherwise its selector and source file. If the result reports `no-selection`, ask the user to click the element and rerun. Request only the context slices you need; use `--context-detail full` only for computed styles or editable text metadata. Full behavior and failure codes live in `references/preview-render.md`.

## Render choices

| Need                                     | Command                                                                       |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| Fast local iteration                     | `npx hyperframes render --quality draft`                                      |
| Final local delivery                     | `npx hyperframes render --quality high --output out.mp4`                      |
| Reproducible container render            | `npx hyperframes render --docker --strict --output out.mp4`                   |
| Local variable-driven batch render       | `npx hyperframes render --batch rows.json --output "renders/{name}.mp4"`      |
| HeyGen-hosted zero-infrastructure render | `npx hyperframes cloud render`                                                |
| Self-managed distributed AWS render      | `npx hyperframes lambda render <project> --width 1920 --height 1080 --wait`   |
| Self-managed distributed GCP render      | `npx hyperframes cloudrun render <project> --width 1920 --height 1080 --wait` |

Use cloud rendering when the user wants hosted rendering without local Chrome, FFmpeg, or AWS. Use Lambda only when AWS ownership is a requirement. Use Cloud Run only when GCP ownership is a requirement. Read the matching reference before running any cloud path.

After verifying a successful render, send one feedback report unless telemetry is disabled or the user opted out:

```bash
npx hyperframes feedback --rating <0-10> --comment "<specific result or friction>"
```

Use `--file-issue` only with consent: it publishes a minimal reproduction to a public URL. The bug report format and privacy warning live in `references/preview-render.md`.

## Read the matching reference before running a command

The following references and owning skills are mandatory command contracts, not optional background reading. Before running a command in the table, read its matching row.

| Need                                                                                   | Reference                             |
| -------------------------------------------------------------------------------------- | ------------------------------------- |
| `init`, `capture`, `skills`                                                            | `references/init-and-scaffold.md`     |
| `lint`, `check`, motion sidecars, `snapshot`                                           | `references/lint-validate-inspect.md` |
| `compare`, `grade-compare`, variable-driven `render --batch`                           | `references/compare-and-batch.md`     |
| `beats` for an existing project's Studio beat grid                                     | `references/beats.md`                 |
| `preview`, `play`, `render`, `publish`, Studio context, feedback                       | `references/preview-render.md`        |
| `doctor`, browser management                                                           | `references/doctor-browser.md`        |
| `auth`, HeyGen-hosted cloud rendering, and template variables                          | `references/cloud.md`                 |
| AWS Lambda deployment and rendering                                                    | `references/lambda.md`                |
| Google Cloud Run deployment and rendering                                              | `references/cloudrun.md`              |
| `info`, `upgrade`, `compositions`, `docs`, `benchmark`, telemetry, media preprocessing | `references/upgrade-info-misc.md`     |

For composition variables, also read `/hyperframes-core` → `references/variables-and-media.md`. For `hyperframes add` and `hyperframes catalog`, use `/hyperframes-registry`. Before `hyperframes present`, read `/slideshow`; before `hyperframes keyframes`, read `/hyperframes-keyframes`. For TTS, transcription, captions, or background removal choices, use `/media-use`.

The specialized commands are deliberately documented by their owning workflows:

```bash
npx hyperframes present <project-dir> --port 3004 --no-open
npx hyperframes beats <project-dir> --json
npx hyperframes keyframes <project-dir> --json
```

`present` serves a navigable deck with presenter and audience synchronization. `beats` is the standalone Studio beat-grid utility defined in `references/beats.md`. `keyframes` surfaces seek-safe animation and motion-path diagnostics.
