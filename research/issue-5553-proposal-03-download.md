# Proposal 3 — Download shape: stream-on-demand zip vs. pre-built zip

## Solution Proposals

**Context:**

- Request: "Download: stream a zip on demand, or serve the zip written at completion?" The route today `readFileSync`'s the whole file and returns it from a `Response` body (`packages/studio-server/src/routes/render.ts:235-271`). For a directory of frames, this can't be reused — `readFileSync` on a directory path throws.
- Research Source: `research/issue-5553-png-sequence-route-state.md` — see the "Download" cross-component step 6 and the `isPlainFile` gate at `render.ts:220-226`.

### Proposal 1 — Stream a zip on demand (no on-disk zip)

- **Overview:** Add one zip endpoint per directory render that reads the on-disk frames + `audio.m4a` sidecar lazily and writes each entry into a `Response` body stream without staging a zip file. The frames on disk stay the only copy; the zip lives entirely in the response stream. Use a streaming archiver (e.g. `archiver` or a hand-rolled `zip-stream` style pipeline) so the response does not buffer the full deliverable in memory before the first byte is sent.
- **Key Changes:**
  - `packages/studio-server/src/routes/render.ts:235-271` — branch on `job.outputPath` shape. If `statSync(job.outputPath).isDirectory()` is true, build a streaming body that:
    - Walks `readdirSync(job.outputPath)` once (one pass, sorted — same order as the producer's `encodeStage.ts:291-293`).
    - Emits a `local file header` per entry and a `data descriptor` per write, packaged in `Content-Type: application/zip`, `Content-Disposition: attachment; filename="<jobId>.zip"`. Use the same `contentDispositionHeader` helper at `render.ts:37-44`.
    - Streams each `readFileSync(join(dir, name))` body chunk through the response.
  - `packages/studio-server/src/routes/render.ts:299-323` — the existing `GET /projects/:id/renders/file/*` route stays file-only; add an explicit `GET /projects/:id/renders/zip/*` companion that validates the jobId via `resolveWithinProject`, then runs the same streaming-zip body. Or fold both into one endpoint with a `?format=zip` query param — the codebase already uses query params for `resolution` and `quality` (`render.ts:124`, `:121`.
  - `packages/studio-server/src/helpers/safePath.ts:24-29` — `resolveWithinProject(rendersDir, jobId)` is the only path-traversal gate needed; the streaming code is downstream of it. The existing `isPrivateProjectFile` (`safePath.ts:36-50`) blocks `.hyperframes/` jobs even after `resolveWithinProject`, so a CRT jobId cannot reach private files.
- **Trade-offs:**
  - **Pros.** No double-write of frames to disk. The CLI's existing precedent (`packages/cli/src/commands/render.ts:1892-1902`) reports a directory's footprint without zipping, so this matches the rest of the project's mental model. Memory usage is bounded by the largest single frame (a 1080p RGBA PNG is on the order of a few MB) rather than by total frame count. The producer's cancel-cleanup logic (`packages/producer/src/services/render/artifactTransaction.ts:404-415`) is simple — just `rmSync(stagingPath, recursive: true)`.
  - **Cons.** Streaming zip has to be implemented (no Hono middleware in the project does this today). Edge cases: streaming-zip clients that re-seek; customers that download in parallel from the same render need byte-for-byte identical streams or the response is non-replayable. The CLI's `--output frames/` flow does not produce a zip today and the route should not invent one for callers who don't ask.
- **Validation:**
  - New: a `render.download.png-sequence.test.ts` case that starts a PNG-sequence render with N frames, hits the new zip endpoint, asserts `Content-Type === "application/zip"`, `Content-Length === sum(headers + N frame bodies + audio body)`, and the zip decodes with `unzip` to the same frame names.
  - New: a path-traversal test for the new endpoint (mirrors `renderDeletion.test.ts:103-112, 114-134`) — jobId with `../` and jobId with a `.hyperframes` prefix must 403.
  - Regression: existing `render.test.ts:839-840` exercising `format: "webm"` / `format: "mov"` still `readFileSync`'s and streams the body unchanged.
  - Cancel: when `state.status === "cancelled"`, the zip endpoint must surface 409 / 404 — the same way the file endpoints 404 today (`render.ts:238-259`).
- **Open Questions:**
  - What zip level? STORE / DEFLATE? STORE reads faster, DEFLATE is universally preferred by consumers. Default to STORE for streaming if memory is cheap.
  - Stream CRC: each entry's CRC is `crc32(buffer)` — needs Node's `zlib.crc32` (Node 18+, the project already requires Node ≥ what's in `Dockerfile.test`). Confirm in PR.
  - Does Studio's UI show "Download zip" or "Download frames" to disambiguate from a notional "Download MP4"?

### Proposal 2 — Pre-built zip written at render completion

- **Overview:** Producer finishes the directory, then a wrapper pass writes `renders/<jobId>.zip` next to it. The route's existing single-file serve routes (`render.ts:235-271, 299-323`) hand it back exactly the way they hand back a `.mp4`. Symmetric with proposal 2 of storage — the only difference is _when_ the zip is written (Eager at completion here, vs. on download there).
- **Key Changes:**
  - `packages/producer/src/services/render/stages/encodeStage.ts:283-313` — keep the directory-write branch. After `encoded()`, schedule `writeZipFromDir(outputPath, join(outputPath, "..", "<jobId>.zip"))` (or a sibling path chosen by the route). This is the producer's only new responsibility.
  - `packages/producer/src/services/renderOrchestrator.ts:5015-5043` — extend the assemble-skip branch: after the directory is staged-and-committed, run the zip step (added as stage 7, observe-only, see existing observability shape `captureObservability` at line 2897). Stage 7 only runs for `png-sequence` and possibly `hls`.
  - `packages/studio-server/src/routes/render.ts:18-23` — add `".zip": "application/zip"` to `RENDER_MIME`; same line in `renderDeletion.test.ts:5` (whitelist) gains `.zip`.
- **Trade-offs:**
  - **Pros.** Reuses the route's file-shaped assumptions end-to-end (existing `readFileSync`, `unlinkSync`, `Content-Disposition`, MIME map). No streaming-zip implementation. The `meta.json` sidecar pattern (`vite.adapter.ts:376-384`, `studioServer.ts:653-661`) already exists; add `zipSizeBytes` to it.
  - **Cons.** Frames are written twice — once into the directory once into the zip — adding an SSD write cost on completion. For a 30-second 30-fps PNG-sequence render (~900 frames at ~MB each), that's an extra ~900 MB of writes. A crash between the directory commit and the zip write leaves the route with two recoverable states (directory without zip = "use the directory path", zip without directory = "use the zip"). The recovery story needs a single source of truth.
  - **Cons.** Producer's `ArtifactTransaction` (`packages/producer/src/services/render/artifactTransaction.ts:281-298`) is configured for `outputPath` — adding a sibling zip moves the producer's surface out of one transaction's scope. Either pre-stage the zip name as part of the transaction (extra bookkeeping) or treat the zip as a separate transaction; both add code.
- **Validation:**
  - New: a `producer.test.ts` case asserting the zip exists alongside the directory after `executeRenderJob`, with the same byte boundary the streaming-zip path emits, and that aborting after the directory commit does not leave a half-built zip.
  - Regression: existing `renderDeletion.test.ts` symlink tests must reject a zip symlink with a target outside `rendersDir`.
  - Latency: a render of N frames costs ~zero zip-time on the render path (zip happens post-commit) but costs disk bandwidth. Add a measure to perf summary (existing `perfStages` at `renderOrchestrator.ts:4359-4999`) — `zipMs` is the right slot.
- **Open Questions:**
  - Can the zip step be skipped if the consumer (Studio UI) doesn't show a zip download? Pro: saves the write. Con: a different consumer (CLI, third-party) then has no zip to grab. The PR's "Done when" specifies a downloadable render — keep the zip unless UI specifically opts out.
  - Is the zip named `<jobId>.zip` (matches the directory `<jobId>`), or `frames-<jobId>.zip` (more user-facing in a Finder window)? Match the directory name; consumers can rename as needed.
  - What does Studio surface when both the directory and the zip are downloadable? One button ("Download zip"), with the directory path reserved for advanced tools (in line with what the CLI does at `packages/cli/src/commands/render.ts:1892-1902`).
