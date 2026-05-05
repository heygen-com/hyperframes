# Palantir Math 15 Framework Fixture

This project is the first fixture for the reusable `video-framework/` contract.
It should not define the framework by itself.

## Authority Order

1. User-provided final SRT or final script controls narration order and timing.
2. Local `palantir-math` Sequencer `seq-frames.json` supplies the active visual
   context for formulas, conditions, and graph references.
3. `seq-data.json` is used only to decode refs such as `D1`, `D4:interp`, and
   `L5-a` into human-readable semantic labels.
4. Hyperframes composition rules control deterministic rendering, captions, and
   motion.

This intentionally avoids treating old problem JSON or `.claude/skills/`
instructions as the source of truth for the final lecture. The user-edited final
script/SRT is the canonical timeline.

## Local Inputs

- SRT: `source/15_pilot-한국어.srt`
- Prompt image: `source/123.png`
- Whisper prompt image: `source/123123.png`
- Sequencer frames:
  `/home/palantirkc/projects/palantir-math/problems/15-abs-cubic-integral-extrema/seq-frames.json`
- Semantic labels:
  `/home/palantirkc/projects/palantir-math/problems/15-abs-cubic-integral-extrema/seq-data.json`

## Generated Plan

Run from the Hyperframes repo root:

```bash
bun run video-framework/scripts/build-project-plan.ts \
  --project video-projects/palantir-math/15-abs-cubic-integral-extrema/project.json
```

Output:

```text
video-projects/palantir-math/15-abs-cubic-integral-extrema/plan/video-project-plan.json
```

The plan is the bridge between final SRT/script, optional Sequencer context, and
the future Hyperframes composition. It records scene boundaries, cue ranges,
active refs, caption policy, motion directives, bottlenecks, and diagnostics.
For this fixture, duplicated cue indexes are expected at some scene boundaries
because the SRT cue can straddle a semantic scene cut. Uncovered cues are not
expected and should block composition generation.

## Generated Composition

Run from the Hyperframes repo root after the plan has been reviewed:

```bash
bun run video-framework/scripts/build-composition.ts \
  --plan video-projects/palantir-math/15-abs-cubic-integral-extrema/plan/video-project-plan.json
```

Output:

```text
video-projects/palantir-math/15-abs-cubic-integral-extrema/composition/
```

The generated root mounts one sub-composition per semantic scene. This keeps
each scene file small enough for Hyperframes lint and future agent revision.
The shell is intentionally layout-first: it proves timing, scene mounting,
captions, and visual-context references before advanced animation is added.

## Loop Contract

1. Parse final SRT/script into a typed timeline.
2. Map the timeline to semantic scenes and active Sequencer refs.
3. Review `diagnostics.cueCoverage` and accept or adjust boundary duplicates.
4. Generate a Hyperframes composition from the scene plan.
5. Run `npx hyperframes lint`, `npx hyperframes validate`, and `npx hyperframes
inspect`.
6. Backpropagate timing, caption, or visual-context failures into the TypeScript
   scene mapping rules before editing the renderer.

Whisper is installed under `tools/whisper.cpp` with the `large-v3` model. In
this fixture it is a timing/validation tool, not the content authority, because
the user has supplied an SRT.
