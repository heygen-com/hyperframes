# Long-form render capture: implementation plans

Spec: [`2026-09-16-long-form-render-capture-design.md`](./2026-09-16-long-form-render-capture-design.md). Read §3 (problem), §5 (design) and §8 (testing) before any plan. Every plan below argues from that spec; the spec travels with the plans.

## Execution order and dependencies

| #   | Plan                                                                                               | Depends on                                                 | Ships alone? | What the user gets                                                                                      |
| --- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------- |
| 1   | [`plan-phase-minus-1-chrome-memory-telemetry.md`](./plan-phase-minus-1-chrome-memory-telemetry.md) | —                                                          | yes          | Chrome RSS and GPU-process fields on `render_error` / `render_complete`; `capture_path` field           |
| 2   | [`plan-phase-0-streaming-duration-cap.md`](./plan-phase-0-streaming-duration-cap.md)               | —                                                          | yes          | Single-worker renders > 240 s stream instead of failing at the disk preflight; gate log gets a `reason` |
| 3   | [`plan-phase-1-parallel-streaming-default.md`](./plan-phase-1-parallel-streaming-default.md)       | Phase 0 (the router's `streamingOk` input applies the cap) | yes          | Multi-worker mp4/mov renders stream by default instead of writing raw frames to disk                    |
| 4   | [`plan-phase-2a-segmented-capture.md`](./plan-phase-2a-segmented-capture.md)                       | Phase 0; Phase −1 for the `capture_path` field             | yes, opt-in  | Single-worker render split into closed-GOP segments, concat-copied; scratch = encoded segments          |
| 5   | [`plan-phase-2b-segment-manifest-resume.md`](./plan-phase-2b-segment-manifest-resume.md)           | 2a                                                         | yes          | A killed render resumes from the last complete segment                                                  |
| 6   | [`plan-phase-2c-browser-recycle-retry.md`](./plan-phase-2c-browser-recycle-retry.md)               | 2a, Phase −1                                               | yes          | Fresh browser every N segments; one retry per segment on target loss                                    |
| 7   | [`plan-phase-2d-multi-worker-segments.md`](./plan-phase-2d-multi-worker-segments.md)               | 2a–2c                                                      | yes          | W workers each own a browser and a queue of segments                                                    |

Plans 1 and 2 are independent and can run in parallel in separate worktrees. Everything else is sequential.

## Global constraints (copied into every plan; executors see only their own task)

- **Worktree:** `~/src/wt/hyperframes/nle-render-spec`, branch `spec/long-form-render-capture`, `bun install --frozen-lockfile` already run. Never work in `~/src/hyperframes` (stale checkout).
- **Git:** commit with `/usr/bin/git` (the `rtk` shell hook rewrites `git commit` into a no-op). Never push. Never edit `.gitignore`. Ignore the LFS fixtures under `packages/producer/tests/**/output/compiled.html` that always show as modified; never `git add -A`.
- **Commit message:** conventional (`feat(engine): …`, `fix(producer): …`, `test(cli): …`), subject under 100 characters, body explains why, last line exactly `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Lefthook runs oxfmt, oxlint, commitlint on commit; if a hook fails, fix and recommit, do not `--no-verify`.
- **Code rules:** TypeScript, no `!` non-null assertions, no `as T` casts (use type guards), no new dependencies. Follow the file's existing comment style. Format with `bunx oxfmt <file>`, lint with `bunx oxlint <file>` before committing.
- **Tests:**
  - `packages/engine`: `cd packages/engine && bunx vitest run <path/to/file.test.ts>`.
  - `packages/cli`: `cd packages/cli && bunx vitest run <path/to/file.test.ts>`.
  - `packages/producer`: `cd packages/producer && bunx vitest run <path/to/file.test.ts>` for one file. The lane runner `node scripts/run-test-lane.mjs unit vitest` runs the whole unit lane. A new `*.test.ts` under `packages/producer/src` is picked up automatically **only if it imports from exactly one of `vitest` or `bun:test`** (`scripts/test-classification.mjs` throws otherwise) and is **not** listed in `INTEGRATION_TEST_FILES`; unlisted files land in the unit lane. Do not add integration-lane files unless the plan says so.
  - Every guard gets a mutation check: break the guarded thing on purpose, watch the test fail, restore.
- **Fixtures for manual gates:** `packages/producer/tests/long-form/gen.mjs` (created in Phase 0, Task 4). Manual renders use the published CLI from `/tmp` or the worktree's `packages/cli` build; the plan says which.
- **Spec is authoritative on names.** Field, env var and function names in the plans are the ones the spec uses; if a plan and the spec disagree, stop and report rather than picking one.

## Names shared across plans (defined once here, used verbatim)

| Name                                                         | Kind                                                                                          | Defined in          | Used by                                        |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------- |
| `streamingEncodeDurationCapEnabled`                          | `EngineConfig` boolean, default `false`, env `PRODUCER_STREAMING_ENCODE_DURATION_CAP_ENABLED` | Phase 0             | Phase 1 (reads via `shouldUseStreamingEncode`) |
| `explainStreamingEncodeGate(...)` → `{ enabled, reason }`    | producer function                                                                             | Phase 0             | Phase 1, 2a (log line)                         |
| `ChromeMemoryStats`                                          | engine type                                                                                   | Phase −1            | 2c (retry records the last sample)             |
| `CaptureOptions.onMemorySample`                              | engine callback                                                                               | Phase −1            | 2a–2d (pass through unchanged)                 |
| `RenderCaptureObservability.capturePath`                     | `"streaming" \| "disk" \| "segmented" \| "hdr_layered"`                                       | Phase −1            | 2a sets `"segmented"`                          |
| `RenderCaptureObservability.segmentIndex`, `.segmentRetries` | numbers                                                                                       | Phase −1 (declared) | 2a, 2c (set)                                   |
| `SegmentSlice`, `planSegments()`                             | producer type + function                                                                      | 2a                  | 2b, 2c, 2d                                     |
| `concatVideoFiles()`                                         | engine function                                                                               | 2a                  | 2b, 2d                                         |
| `runCaptureSegmentedStage()`                                 | producer stage                                                                                | 2a                  | 2b, 2c, 2d extend it                           |
| `SegmentManifest`                                            | producer type                                                                                 | 2b                  | 2c, 2d                                         |
| `HF_SEGMENTED_CAPTURE`                                       | env, `"true"` opts in (2a), default flips in 2d                                               | 2a                  | all Phase 2                                    |
| `HF_SEGMENT_FRAMES`                                          | env, frames per segment, default `3000`                                                       | 2a                  | 2b–2d                                          |
| `HF_SEGMENT_BROWSER_RECYCLE`                                 | env, segments per browser session, default `3`                                                | 2c                  | 2d                                             |

## Linear tracking (Product Infra / HyperFrames project)

Umbrella: [PRINFRA-1196](https://linear.app/heygen/issue/PRINFRA-1196) (spec + README attached, PostHog evidence, related PRINFRA-647 / 358 / 1103).

| Phase                        | Ticket       | Task tickets                       |
| ---------------------------- | ------------ | ---------------------------------- |
| −1 Chrome memory telemetry   | PRINFRA-1197 | 1216, 1217, 1219, 1220, 1221, 1222 |
| 0 streaming duration cap     | PRINFRA-1198 | 1206, 1208, 1209, 1210, 1211       |
| 1 parallel streaming default | PRINFRA-1199 | 1212 (sizing), 1213, 1214, 1215    |
| 2a segmented capture         | PRINFRA-1200 | 1223, 1224, 1225, 1229, 1232       |
| 2b manifest + resume         | PRINFRA-1201 | 1233, 1234, 1235                   |
| 2c recycle + retry           | PRINFRA-1202 | 1236, 1238, 1239                   |
| 2d multi-worker + default-on | PRINFRA-1203 | 1240, 1241, 1242                   |

Each phase ticket has its plan file attached; each task ticket carries the task's files, interfaces and steps. Phase-level `blockedBy` relations mirror the dependency table above.
