---
name: hyperframes-cli
description: HyperFrames CLI dev loop. Use when running npx hyperframes init, add, catalog, capture, lint, validate, inspect, layout, snapshot, preview, play, render, publish, lambda, doctor, browser, info, upgrade, skills, compositions, docs, benchmark, telemetry, transcribe, tts, or remove-background, or when troubleshooting the HyperFrames build/render environment. Entry point for AWS Lambda cloud rendering (`hyperframes lambda deploy / render / progress / destroy / policies`).
---

# HyperFrames CLI

Everything runs through `npx hyperframes` unless project instructions specify a local wrapper. Obey the local wrapper exactly. Requires Node.js >= 22 and FFmpeg.

## Workflow

1. **Scaffold** — `npx hyperframes init my-video` (or `capture` from a URL)
2. **Write** — author HTML composition (see the `hyperframes-core` skill)
3. **Lint** — `npx hyperframes lint`
4. **Validate** — `npx hyperframes validate` (runtime errors + contrast)
5. **Visual inspect** — `npx hyperframes inspect`
6. **Preview** — `npx hyperframes preview` opens **Studio**, the timeline editor where the user can manually edit anything (not just watch). Review there, then ask before rendering.
7. **Render** — pick the variant:
   - Iterate: `npx hyperframes render --quality draft`
   - Deliver: `npx hyperframes render --quality high --output out.mp4`
   - CI / cross-host repro: `npx hyperframes render --docker --strict --output out.mp4`
   - Cloud (long / large): `npx hyperframes lambda render ./my-project --width 1920 --height 1080 --wait` (see Lambda below)

Run lint, validate, and inspect before preview. `lint` catches missing `data-composition-id`, overlapping tracks, and unregistered timelines. `validate` loads the composition in headless Chrome and reports runtime console errors plus WCAG contrast issues. `inspect` seeks through the timeline and reports text spilling out of bubbles/containers or off the canvas — and, when a `*.motion.json` sidecar is present, verifies motion intent (entrances firing under seek, stagger order, in-frame, liveness) against that same seeked timeline.

For motion-heavy work, prefer snapshot-driven iteration and a `*.motion.json` sidecar — see `references/lint-validate-inspect.md` for the discipline and motion-verification spec.

## Agent Conventions

Cross-cutting rules that hold for every command:

- **`--json` is available on every command except `render`, `preview`, and `play`.** Use it for any agent / CI invocation of the supported commands; output includes a `_meta` envelope (cli version, latest available, update advice). `render` reports status via stdout + exit code only — verify success with the post-render check below; `preview` / `play` are servers, no JSON.
- **`doctor --json` always exits 0**, even when the environment is broken. Gate on the payload's `ok` field: `npx hyperframes doctor --json | jq -e '.ok' > /dev/null`. This insulates pipelines from CLI release churn.
- **Non-TTY mode is auto-detected.** When `stdout` is not a TTY (CI, agents, piped output) the CLI auto-switches to non-interactive; `init` then **requires `--example`**. Pass `--non-interactive` to force this mode even on a TTY.
- **CI gating on render**: `--strict` fails on lint errors, `--strict-all` fails on warnings too, `--strict-variables` fails on undeclared `--variables` keys.
- **Paths in `--json` are redacted** — `$HOME` becomes the literal `$HOME` so output is safe to paste into bug reports and agent contexts.
- **Render is user-gated.** Never auto-render once the checks pass. Pause at `preview`, tell the user the video is editable in Studio, and render only after they approve.
- **Post-render verification.** After `render` returns exit 0, confirm the output file exists and has plausible size before reporting success: `[ -s "$OUTPUT" ] || echo "render produced no output"`. The CLI prints `◇  <path>` on success; for long renders also sanity-check duration with `ffprobe -i "$OUTPUT" -show_format -v error`.

## Routing

| Want to…                                                                                                   | Read                                  |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Scaffold a project (`init`, `capture`, `skills`)                                                           | `references/init-and-scaffold.md`     |
| Check correctness (`lint`, `validate`, `inspect`, `snapshot`)                                              | `references/lint-validate-inspect.md` |
| Preview or render (`preview`, `play`, `render`, `publish`)                                                 | `references/preview-render.md`        |
| Diagnose the environment (`doctor`, `browser`)                                                             | `references/doctor-browser.md`        |
| Cloud render on AWS Lambda (`lambda deploy / sites / render / progress / destroy / policies`)              | `references/lambda.md`                |
| Everything else (`info`, `upgrade`, `compositions`, `docs`, `benchmark`, `telemetry`, asset preprocessing) | `references/upgrade-info-misc.md`     |

## Cross-Skill Hand-Offs

- **Tailwind projects** (`init --tailwind`) → use `hyperframes-core` (Tailwind reference) before editing classes or theme tokens.
- **Registry blocks/components** (`hyperframes add`, `hyperframes catalog`) → use `hyperframes-registry` for install paths, sub-composition wiring, and snippet merging.
- **Asset preprocessing** (`tts`, `transcribe`, `remove-background`) → use `hyperframes-media` for voice selection, Whisper model rules, captions, and TTS-to-captions chain.
- **Parametrized renders** (`--variables`) → declared via `data-composition-variables` on `<html>`; see `hyperframes-core` for the full schema.

## Lambda (Cloud Rendering)

`hyperframes lambda` deploys distributed rendering to AWS Lambda and drives renders from your laptop or CI. End-to-end is three commands:

```bash
npx hyperframes lambda deploy                                             # provision SAM stack (Lambda + Step Functions + S3)
npx hyperframes lambda render ./my-project --width 1920 --height 1080 --wait
npx hyperframes lambda destroy                                            # tear down (S3 bucket is retained)
```

Use Lambda when a render is too long / too large for one host (multi-minute videos, 4K, large parallel batches) and you have AWS credentials configured. For dev-loop iteration stay on local `render`.

See `references/lambda.md` for prerequisites, all 6 subcommands (`deploy`, `sites create`, `render`, `progress`, `destroy`, `policies`), IAM policy validation, state files, and cost / cleanup rules.

## Minimum Completion Gate

### Static gates

```bash
npx hyperframes lint
npx hyperframes validate
```

Add `inspect` for layout-sensitive work and `render --strict` in CI to fail on lint errors.

### Visual smoke test — required when the project uses sub-compositions

`lint` / `validate` / `inspect` evaluate each composition **in isolation**. They never load `index.html` and mount sub-compositions via `data-composition-src`, so they cannot catch cross-file mount failures (see `hyperframes-core` → `references/sub-compositions.md`, "Common pitfalls"). The only gate that catches them is one that actually loads `index.html` and seeks the timeline.

Use `hyperframes snapshot` — it loads the project the same way `render` does (so it exercises the same mount path) but only captures the timestamps you request, so it's seconds instead of a full render:

```bash
# Capture one frame at the midpoint of every sub-composition.
# Midpoints = data-start + data-duration/2 for each host slot in index.html.
npx hyperframes snapshot --at <t1>,<t2>,<t3>,...

# Or, if you don't need per-scene targeting, an evenly-spaced sample:
npx hyperframes snapshot --frames 9
```

Output lands in `snapshots/frame-NN-at-Xs.png`. Eyeball each frame against the scene plan.

Per-frame red flags (each maps to a specific failure mode the static gates miss):

| What you see                                                                       | Root cause                                                                                  |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Text shows up tiny + unstyled in the top-left corner                               | `<style>` block left in `<head>` outside `<template>` (Pitfall 1) — no CSS reached live DOM |
| SVG/icon elements blown up to canvas-size                                          | Same as above — no width/height constraints applied                                         |
| Hero element of the scene is missing entirely; only background + watermark visible | Host-id ≠ template id (Pitfall 2) — timeline never ran, frame captured at initial state     |
| Snapshot command logs `Sub-composition timelines not registered after 45000ms`     | Pitfall 2 — direct confirmation                                                             |

`snapshots/` can be deleted after eyeballing; the user-facing final render is a separate pass with `npx hyperframes render`.
