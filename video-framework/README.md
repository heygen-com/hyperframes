# Hyperframes Video Automation Framework

This framework turns a user-authored lecture script or recorded narration into a
repeatable Hyperframes video project. The first project is the Palantir Math
problem 15 pilot, but the framework is not owned by that pilot.

## Authority Order

1. User script, final SRT, or user-recorded MP4 is the narration authority.
2. Whisper supplies timing when the user provides MP4 without captions.
3. A project manifest maps transcript time into semantic scenes.
4. Optional visual context adapters attach domain-specific refs, such as
   Palantir Math Sequencer formulas and graph refs.
5. Hyperframes composition HTML is generated only after the scene plan is
   reviewable.

## Layers

- `VideoProjectManifest` defines the project root, language, source assets,
  render target, scene map, and workflow bottlenecks.
- `TranscriptTimeline` normalizes script/SRT/Whisper output into timed cues.
- `SceneMap` assigns transcript time spans to semantic scenes before animation.
- `VisualContext` attaches domain refs without letting them override narration.
- `MotionPlan` records caption placement, visual intent, and motion directives.
- `PlanDiagnostics` records cue coverage, scene-boundary duplicates, and active
  bottlenecks before composition generation.
- `RenderManifest` is the future bridge from plan JSON to Hyperframes HTML.
- `AuditManifest` stores lint, inspect, validation, and render evidence.

## Loop

```bash
bun run video-framework/scripts/build-project-plan.ts \
  --project video-projects/palantir-math/15-abs-cubic-integral-extrema/project.json
```

The output plan is intentionally a review surface. Do not generate composition
HTML until the project plan states where each scene goes, why it goes there, and
what visual context it needs. Treat `diagnostics.cueCoverage` as the first
review gate: uncovered cues are blocking, and duplicated cue indexes identify
scene boundaries that need deliberate acceptance or adjustment.

After reviewing the plan, generate a deterministic composition shell:

```bash
bun run video-framework/scripts/build-composition.ts \
  --plan video-projects/palantir-math/15-abs-cubic-integral-extrema/plan/video-project-plan.json
```

This writes a root `index.html`, one sub-composition per semantic scene, and a
`build-manifest.json` that records the plan-to-composition bridge.

For composition HTML, follow the repo Hyperframes skills: design identity first,
layout before animation, paused GSAP timelines on `window.__timelines`, and then
`npx hyperframes lint` plus `npx hyperframes validate`.
