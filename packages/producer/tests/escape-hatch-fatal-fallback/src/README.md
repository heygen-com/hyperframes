# escape-hatch-fatal-fallback — field-signal reproducer

> **This is a REPRODUCER, not a FIX.** No root cause has been identified. The
> fixture exists so a future diagnostic pass has a real, checked-in composition
> that reliably surfaces the shift, and so a proposed fix can be validated
> against the same shape the field reported.

## Field signal envelope

- `ts=1784039841`
- Platform: `win32/x64`
- CLI version: `0.7.57`
- Reported in `#hyperframes-cli-feedback`

## Failure mode

At **frame 120** of a 30fps render (i.e. t=4.0s), a DOM `<img>` layer positioned
absolutely inside the composition shifts by a small but visually obvious offset
from its baseline position. The shift is not an animation frame — it is a
compositor artifact that appears in the encoded output and is absent from the
authored timeline.

## Why this fixture matters — both escape hatches fail

The two known escape hatches for shifted-layer / compositor-race classes of bug
are:

- **`PRODUCER_FORCE_SCREENSHOT=true`** — forces the "screenshot" capture path
  in `packages/producer/src/services/renderOrchestrator.ts` and
  `packages/engine/src/config.ts`. This is also the default; setting it
  explicitly is idempotent with the default state, but the field report
  set it explicitly to rule out env-inference bugs.
- **`HF_DE_PARALLEL_ROUTER=false`** — forces the distributed-encoder parallel
  router OFF in `packages/producer/src/services/renderOrchestrator.ts` (default
  is off; the router is opt-in via `HF_DE_PARALLEL_ROUTER=true`).

Prior escape-hatch cases (e.g. the RAM-pressure `Runtime.callFunctionOn`
cluster tracked around #1087 / #2504) had at least one working fallback: either
the screenshot path or the single-worker path would produce a clean render even
when the other was regressing.

**This case has none.** Applying both escape hatches leaves the shift intact.
That's the anomaly worth codifying — every prior triage playbook for this
class of bug assumed at least one lever worked.

## Composition shape (verbatim from field envelope)

- Standalone 1920x1080 render (no host composition; no picture-in-picture)
- GSAP `paused: true` timeline, driven from outside via `tl.progress()` /
  `tl.seek()` (matches `parallel-capture-regression` and every other
  GSAP-driven HF regression fixture)
- **Absolute PNG layers** — `<img>` tags positioned via `position: absolute`
  with explicit `top` / `left` / `width` / `height`
- **4 independent scenes** — no cross-fades that overlap the shift frame;
  the middle 1.1s of scene 2 (which contains frame 120) is a clean opacity=1
  window with no compositional cross-traffic

`src/index.html` implements exactly this shape. PNG bytes are inlined as tiny
data URIs (1x1 solid colors that the layout scales to layer size) — this
preserves the layout shape without shipping binary assets. If diagnostic work
reveals the shift is sensitive to real image decode paths (e.g. sRGB gamma,
non-square intrinsic dimensions, animated PNG chunks), swap the inline URIs
for byte-identical copies of the field asset and re-run.

## How this fixture is skipped

The fixture is tagged `field-signal-reproducer` and `known-broken` in
`meta.json`. Two mechanisms combine to keep CI green:

1. **Local `pnpm test` / `bun run test`** — the producer package's `test`
   script (`packages/producer/package.json`) exclude the
   `field-signal-reproducer` tag via `--exclude-tags`, alongside the
   pre-existing `transparency` exclusion.
2. **CI regression sweep** — `.github/workflows/regression.yml` runs shards
   with explicit fixture-name arg lists. This fixture's name is not in any
   shard, so it won't be picked up.

Both belt-and-suspenders are intentional. If a future dev drops the tag
without updating the workflow (or vice versa), the fixture stays skipped.

## When a fix lands

1. Verify the fix eliminates the shift by running the fixture manually:
   ```
   PRODUCER_FORCE_SCREENSHOT=true HF_DE_PARALLEL_ROUTER=false \
     bun run --cwd packages/producer test escape-hatch-fatal-fallback
   ```
   The `--exclude-tags` filter is bypassed when an explicit fixture name is
   passed — the tag exclusion only fires when the harness is enumerating.
2. Drop the `field-signal-reproducer` and `known-broken` tags from `meta.json`
   (keep `regression` and `render-compat`).
3. Add `escape-hatch-fatal-fallback` to the currently-lightest shard's `args`
   in `.github/workflows/regression.yml` (see the LPT-heuristic comment there
   for balancing guidance).
4. If baselines don't exist yet, run `bun run --cwd packages/producer
   test:update escape-hatch-fatal-fallback` to freeze them, then commit the
   `output/` directory contents that the harness writes.

## Diagnostic starting points

For whoever picks this up — a few threads worth pulling before treating the
composition shape as the root cause:

- **Does the shift move to a different frame if the fixture duration
  changes?** If frame 120 tracks with 4s wall-clock, it's a timing-side
  effect. If it tracks with the third-scene boundary regardless of duration,
  it's a scene-transition effect.
- **Does the shift survive a single-worker in-process render?** The
  in-process path lives in `packages/producer/src/regression-harness.ts` and
  bypasses both the screenshot toggle and the DE parallel router. If the
  shift disappears in-process, the fatal-fallback surface is inside the
  Docker/lambda capture harness, not the composition renderer.
- **Does the shift survive on Linux/darwin as well as win32/x64?** The field
  report is win32-only. Cross-platform reproduction would rule out a
  win32-specific input pipeline (Chromium's Windows compositor thread has a
  history of shipping DOM shifts under memory pressure).
- **Compare against the `parallel-capture-regression` fixture** — same
  GSAP-paused shape, no reported shift. What's the delta? Likely candidates:
  absolute-positioned `<img>` decode timing, per-scene opacity gating, or the
  layer's y/x tween during the shift window.
