# Proposal 1 — Storage shape for Studio's PNG-sequence deliverable

## Solution Proposals

**Context:**

- Request: a PNG-sequence render started from Studio has to live somewhere on disk. Choose between (a) a folder inside `renders/` named like the job id, or (b) a single-file zip produced at completion. The current route writes `${jobId}.mp4` files only (`packages/studio-server/src/routes/render.ts:149-154`).
- Research Source: `research/issue-5553-png-sequence-route-state.md` — see "Component map and current state", "Cross-component data flow", and "Touchpoints" sections for the file-by-file evidence behind each proposal below.

### Proposal 1 — Folder named by job id (no zip)

- **Overview:** Treat the PNG-sequence output as a directory under `renders/<jobId>/` whose immediate children are `frame_NNNNNN.png` plus an optional `audio.m4a`. Producer already writes this shape (`packages/producer/src/services/render/stages/encodeStage.ts:283-313` — `mkdirSync(outputPath, { recursive: true })`, then `copyFileSync(join(framesDir, name), dst)` with `formatExportFrameName(i, "png") = frame_<i+1 padded>.png`). The host's route hands the directory path to the producer and reads it back unchanged.
- **Key Changes:**
  - `packages/studio-server/src/routes/render.ts:154` — for `format === "png-sequence"` build `outputPath = join(rendersDir, jobId)` (no extension). Producer's `ArtifactTransaction(outputPath, "directory")` (`packages/producer/src/services/renderOrchestrator.ts:2882-2886`) already implements atomic directory publish.
  - `packages/studio-server/src/types.ts:164` — widen `format` union to include `"png-sequence" | "gif" | "hls"` so the adapter contract matches the producer's existing `RenderOutputFormat` (`packages/producer/src/services/renderOrchestrator.ts:343-360`).
  - `packages/studio/vite.adapter.ts:311-402` and `packages/cli/src/server/studioServer.ts:569-692` — `removeCancelledOutput` widens from a 2-path `unlinkSync` loop (line 322-336 / 596-610) to `rmSync(opts.outputPath, { recursive: true, force: true })` when the format is directory-shaped.
  - `packages/studio-server/src/routes/render.ts:152` — extend `OUTPUT_EXT: Record<string, string>` to add `"png-sequence": ""` so the existing `path = join(rendersDir, `${jobId}${ext}`)` produces the directory path.
- **Trade-offs:**
  - **Pros.** No new zip step on disk; on-render-cost is unchanged from CLI (`packages/cli/src/commands/render/plan.ts:42-62` already plans directory output this way); the producer's existing backup-handoff path on a re-render into the same `jobId` (`packages/producer/src/services/render/artifactTransaction.ts:381-398`) keeps working without changes; consumption tools (After Effects, Nuke, ffmpeg `image2` demuxer) grovel the directory directly without unpacking.
  - **Cons.** Every other route endpoint (`view`, `download`, `file/*`, `delete`) has to be widened to recognise directories (`render.ts:235-271, 299-323, 281-296`) — see proposals 2-4 below for the follow-on shape. The on-disk size of a directory is its inode size, not its deliverable footprint (`packages/cli/src/commands/render.ts:1894-1896` flagged this exact problem already).
- **Validation:**
  - Regression: existing `renderDeletion.test.ts` cases (`packages/studio-server/src/routes/renderDeletion.test.ts:56-134`) must still pass against `mp4/webm/mov` — file-shaped delete is unchanged.
  - New: a `render.start.png-sequence.test` that posts `format: "png-sequence"` and asserts `RenderJobState.outputPath` ends in `<jobId>` and a subsequent `GET /projects/:id/renders` discovers the directory.
  - New: after a `startRender` returns, write `frame_000001.png` into the directory and assert `GET /projects/:id/renders` reports a directory-shaped entry with a non-zero `frameCount` and `sizeBytes`.
  - Producer side: the existing `artifactTransaction.test.ts:123-127` already covers directory commit + collision — no new producer tests required.
- **Open Questions:**
  - Do tasks in development / cloud runners also need to land a directory under `renders/`, or do they always go through the CLI's existing zip approach (`packages/cli/src/commands/render.ts:1892-1902` sums contained file sizes without zipping) — the answer changes whether Studio needs zip download at all (proposal 03 addresses this).
  - Is the per-frame folder `audio.m4a` sidecar (`packages/producer/src/services/render/stages/encodeStage.ts:303-311`) surfaced separately in the route, or only as a "has audio" boolean — see proposal 02 for the listing shape.

### Proposal 2 — Zip at producer completion, treat the zip as the deliverable

- **Overview:** Keep the producer's directory write step unchanged but add a final pass that zips `renders/<jobId>/{*.png, audio.m4a}` into `renders/<jobId>.zip`, which becomes the only artifact the route knows about. The route's file-shaped assumptions (`packages/studio-server/src/routes/render.ts:325-369` filter on `*.mp4|*.webm|*.mov`) change only by adding `*.zip` to the existing whitelist.
- **Key Changes:**
  - `packages/producer/src/services/renderOrchestrator.ts:5015-5043` — add a zip step after the directory is committed and validate `expectedFrames` against the zip's listing, gated on `outputFormat === "png-sequence"`. Reuse the existing `MIXED_AUDIO_FILENAME` constant for the audio sidecar inclusion test.
  - `packages/producer/src/services/render/stages/encodeStage.ts:283-313` — keep the directory write as the publisher's intermediate; introduce a `runZipStage({ sourceDir, zipPath, … })` that streams `readdirSync(sourceDir)` into a single `application/zip` blob.
  - `packages/studio-server/src/routes/render.ts:18-23` — extend `RENDER_MIME` with `".zip": "application/zip"` and add it to `RENDER_ARTIFACT_EXTENSIONS` (line 24).
  - Adapters in `packages/studio/vite.adapter.ts` and `packages/cli/src/server/studioServer.ts` — unchanged: `removeCancelledOutput`'s file-loop (`:322-336` / `:596-610`) already covers a single file and its `.meta.json` sidecar, which is now a `.zip` and its `.meta.json`.
- **Trade-offs:**
  - **Pros.** Route-level code deltas are smaller: view / download / file-serve / delete all reuse single-file code paths. The `resolveRenderArtifacts` whitelist (`packages/studio-server/src/routes/render.ts:26-35`) extends by one entry; no algorithm change.
  - **Cons.** On disk, the directory is now an intermediate that must be wiped on completion — a crash between directory-write and zip-write leaves a half-built state the route has to detect (current `ArtifactTransaction` rollback at `artifactTransaction.ts:404-415` already rmSync's the staging path; the on-disk final directory needs similar treatment). Consumer tools that pre-existed for in-place directory reads (After Effects's image-sequence import) need a manual unzip step. Net on-disk cost goes up because the frames are written twice (once in the directory, once in the zip); an SSD-only lane is fine, but slow disks take a render-quality hit.
- **Validation:**
  - New: a `producer.test.ts` case asserting the zip exists, the zip's name list matches `frame_NNNNNN.png` × frameCount, and the sidecar audio (when present) is preserved.
  - Regression: the route's existing `GET /projects/:id/renders` listing must now include `*.zip` files (line-330 whitelist widens); existing tests in `render.test.ts:839-840` exercising `format: "webm"` / `format: "mov"` still pass because they don't depend on the zip pathway.
  - Path-traversal: existing `renderDeletion.test.ts:114-134` symlink test still rejects, but only because no zip is written for those legacy tests — add an analogous test that a symlinked `*.zip` whose target is outside `rendersDir` is rejected.
- **Open Questions:**
  - Should zip size / frame count come from the zip's central directory (cheap, requires `yauzl`) or by re-walking the source dir (free, redundant with the producer's directory listing)? Either works; the zip's central directory is the source of truth if both disagree after a crash.
  - Per-frame encryption / password? Out of scope for #5553, but the zip approach opens a future door; flag in PR.
  - Is `.zip` a format the user can pick from the render UI, or is it the always-on wire format? Easier UX if png-sequence shows up as a single-named render entry and the zip is implicit.
