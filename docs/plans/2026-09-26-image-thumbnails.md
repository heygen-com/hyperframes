# Bounded timeline JPEG thumbnails

Status: validating. Local only; PR publication authorized, merge/release excluded.
Risk tier 3: image processing across the project file-serving boundary.

## Evidence and goal

Base: main 640e99043, isolated worktree. Timeline image strips request original 2560x1920 photos but budget them as 240x135. A frozen local project exposes 43 original JPEGs in its timeline. No private media will be committed or uploaded.

A client-side resizing experiment passed 35 tests and reduced retained pixel dimensions, but three-run cold-load readiness increased from a median 2.47s to about 3.8s. Offscreen encoding and bitmap resizing did not remove this regression. Reject that approach.

Deliver bounded JPEG thumbnail responses to the existing scheduler, preserving original composition assets and export behavior. Require before/after browser evidence, correct aspect, no missing thumbnails, no material startup regression, cache invalidation, cancellation, and focused negative-path tests before publishing.

## Reviewed plan

1. Add a fixed-size JPEG route using existing project resolution/path containment and Sharp (already a CLI dependency). No arbitrary remote URLs, requested dimensions or output paths. Limit input size/pixels and concurrent work. Keep a bounded in-memory cache, invalidate on file stat changes, deduplicate concurrent requests.
2. Route only same-origin local preview JPEGs through it. Preserve other image types and external sources. Retain scheduler ownership and account for actual thumbnail pixels. Fall back to original sources on unsupported/unavailable thumbnail endpoints.
3. Test unknown projects, traversal/symlink escapes, non-images, corrupt/oversized files, concurrent requests, changed assets and HTTP validation. Test client fallback and cancellation.
4. Repeat frozen-project browser measurements and capture the actual component using synthetic public media. Run types, focused tests, lint/format and changed-file audit; review complete diff.

## Invariants and review

No user composition mutations, export substitution, private uploads or new remote processing. Reuse existing safe path resolution; reject traversal before opening a source. Read bounded input into memory so asynchronous processing does not reopen a retargetable path. Decoder metadata must confirm JPEG; reject other formats despite suffix. Cache is per API host, bounded by bytes and entries, includes file identity, and dies with host. Sharp failures return a bounded error and the client preserves original-image behavior. Cancellation must not leak object URLs. Avoid claiming decoded-pixel estimates equal process RSS. All work is reversible by reverting the PR; no data migration or persisted thumbnail artifacts.

## Non-goals

Photo lookahead, video preloading, PNG/WebP/GIF/SVG conversion, full-resolution rendering changes, server-side remote fetches, and general image transformation APIs are separate work.

## Validation log

Pending implementation and end-to-end comparison. Native dependency loading must be verified in supported CI hosts before merge.

### Measurements and implementation review

Three browser runs per variant, Chrome 147 headless at 1280x720, fixed composition/media, same Vite server and original/changed component alternated. Readiness is the harness threshold of at least 147 mounted timeline images decoded; it is not time-to-first-frame. Runtime clock was read from the actual composition player, after clicking Studio Play. Playback samples last ten seconds. Native-image dimensions are a resource-size estimate; summed Chrome process RSS is a separate noisy measurement.

| Median | Original | Server thumbnails |
| --- | ---: | ---: |
| Readiness | 2342 ms | 2418 ms |
| RAF callbacks / ten seconds | 579 | 593 |
| Largest RAF gap | 208 ms | 58 ms |
| Gaps above 50 ms | 3 | 1 |
| Chrome process RSS | 2205 MiB | 2239 MiB |

All three runs had 52 unique loaded timeline sources. Their decoded-pixel estimate was 956 MiB before and 4.4 MiB after. This is not a measured RAM reduction: RSS did not improve. Startup differs by 76 ms (3.2%); do not claim startup speedup. Frame pacing improved in these samples; machine load remains a limitation, and the measurements do not prove sustained whole-film FPS gains. The first cold server-cache sample in an earlier series took 2903 ms; cached samples took 2657 and 2519 ms. Composition photo downloads remain unchanged.

Public evidence uses a synthetic test chart in the real ImageThumbnail component, with original and thumbnail images at identical display size. User media stays local. Sharp sizing/input-limit semantics checked against https://sharp.pixelplumbing.com/api-resize/ and https://sharp.pixelplumbing.com/api-constructor/.

Review corrections: rejected client resize startup regression; bounded server work/cache and input sizes; preserved non-JPEG/external sources and old-server fallback; extracted path validation to lower route complexity; kept lockfile changes limited to the existing Sharp dependency mapping. Final local validation: 32 client/scheduler tests and 13 server/coordinator tests pass; Studio and studio-server type checks pass; lint/format and changed-file audit pass (duplication warnings remain). Server build passes. Implementation review additionally rejects non-JPEG magic bytes before invoking native decoding. PR CI and cross-platform native dependency checks remain pending.
