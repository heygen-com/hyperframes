# [#5553] Studio render route — PNG-sequence support

**Repo:** heygen-com/hyperframes · measured against current `main`
**Status:** implementation plan refined from maintainer feedback; this document records the implementation decisions
**Inputs:** issue [heygen-com/hyperframes#5553](https://github.com/heygen-com/hyperframes/issues/5553), research doc `research/issue-5553-png-sequence-route-state.md`, proposal docs `research/issue-5553-proposal-{01..04}-*.md`
**Feedback reviewed:** `plans/feedback/2026-10-14-issue-5553-png-sequence-route.md`, checked against `main` at `9b996059`. The reviewer did not run a PNG-sequence render through Studio.

> The plan is laid out as a sequence of decisions followed by an implementation sequence. The validation sections below are scoped to gaps the issue's "Done when" calls out.

## Current Context

`packages/producer/src/services/renderOrchestrator.ts:2868-2890` and `packages/producer/src/services/render/stages/encodeStage.ts:283-313` already implement the producer-side of PNG-sequence; `ArtifactTransaction(outputPath, "directory")` (`packages/producer/src/services/render/artifactTransaction.ts:257-298`) is the source of truth for directory atomicity, and the in-process CLI ships directory output without zipping (`packages/cli/src/commands/render.ts:1892-1902`).

The Studio render route (`packages/studio-server/src/routes/render.ts`) is single-file shaped end-to-end. The adapter contract in `packages/studio-server/src/types.ts:164` only accepts `"mp4" | "webm" | "mov"`. `FORMAT_EXT` (`render.ts:111-113`) gives every format a single extension. DELETE only knows about extensions present in `RENDER_ARTIFACT_EXTENSIONS` (`render.ts:24`), and the list endpoint filters `readdirSync` by `*.mp4 | *.webm | *.mov` (`render.ts:331-332`). Both adapter hosts (`packages/studio/vite.adapter.ts:311-402`, `packages/cli/src/server/studioServer.ts:569-692`) replicate the same file-loop cancel cleanup.

Path-safety helpers and tests are already in place: `resolveWithinProject` and `isPrivateProjectFile` (`packages/studio-server/src/helpers/safePath.ts:24-67`) work for both files and directories; existing tests in `renderDeletion.test.ts:103-112, 114-134` cover the file-traversal defense but no equivalent exists for directories.

The CLI's comment at `packages/cli/src/server/studioRenderTelemetry.ts:27-31` notes the gap explicitly: **Studio has no png-sequence option today; this change fills it.**

Two adapter assumptions need to change along with the route: both derive `.meta.json` from the output filename's extension, and both cancel-cleanup paths call `unlinkSync` on the output. Neither works for an extensionless directory output. The producer stages directory artifacts in hidden sibling directories inside `renders/` (`renderOrchestrator.ts:2882-2885`), so listing must also skip dot-prefixed entries explicitly.

## Requirements

### Functional Requirements

1. Studio can start a render with `format: "png-sequence"` from `POST /projects/:id/render`. The completed artifact is `renders/<jobId>/`, containing `frame_NNNNNN.png` files and optional `audio.m4a` (`MIXED_AUDIO_FILENAME`, defined at `packages/engine/src/services/audioMixer.ts:64`).
2. `GET /projects/:id/renders` lists the directory as one row. Directory rows add `kind: "directory"`, `frameCount`, and `audioSidecar`, and use the existing numeric `size` field for summed bytes. Existing file rows keep their current shape.
3. `GET /render/:jobId/download` streams a STORE ZIP64 archive on demand. `GET /render/:jobId/view` returns 404 for directory jobs, and Studio hides the video-preview/open action for those rows.
4. `DELETE /render/:jobId` returns 409 while the render is in flight. Otherwise it removes a validated directory as a whole, rejects symlinks and traversal, and preserves existing file deletion behavior.
5. `POST /render/:jobId/cancel` leaves no output directory or metadata sidecar behind, including when cancellation races with a completed directory publish.
6. Route and adapter behavior branches on artifact kind (`"file"` or `"directory"`), not a literal format check. PNG-sequence is in scope; HLS is also a producer-side directory artifact and can reuse these branches if/when the route accepts it.

### Non-Functional Requirements

- **Performance:** The listing discovers entries from `renders/`, but reads cached `frameCount` and byte `size` from the sidecar when present. It scans a directory only if its sidecar is missing or lacks `frameCount` (for example, a CLI-created render).
- **Scalability:** The on-demand STORE ZIP64 response streams file chunks rather than buffering the archive. Its `Content-Length` can be computed from entry stats and ZIP record sizes; ZIP64 is required for large sequences.
- **Observability:** Existing `renderJobs` and SSE progress flow remain. `RenderJobState` records an optional artifact `kind` so view, download, delete, and cancel paths can branch without inferring from an extension.
- **Security:** Listing rejects dot-prefixed staging entries, symlinked directories, and paths outside the project. Directory deletion uses `lstat` and recursive removal only for a real directory; it retains the existing `resolveWithinProject` and `isPrivateProjectFile` checks.

## Design Decisions

### 1. Storage shape — folder named by job id

Keep the producer's PNG-sequence output at `renders/<jobId>/` (containing `frame_NNNNNN.png` × N plus optional `audio.m4a`) and hand the directory path through unchanged. Determine directory behavior from the artifact kind, not `format === "png-sequence"`: the producer also publishes HLS as a directory (`packages/producer/src/services/renderOrchestrator.ts:2882-2885`). HLS format enablement and HLS-specific listing facts remain out of scope.

- The producer's `ArtifactTransaction("directory")` is the existing source of truth for directory atomicity (`packages/producer/src/services/render/artifactTransaction.ts:281-298`). No new transaction code in the producer.
- The in-process CLI already plans directory output this way: `packages/cli/src/commands/render/plan.ts:42-62` has `png-sequence: ""`, and `packages/cli/src/commands/render.ts:1894-1902` exposes the directory's summed byte footprint without zipping.
- Consumer tools (After Effects, Nuke, ffmpeg `image2` demuxer) read directories directly; a zip layer is a manual step the user can take if they need it.
- The CLI's `formatRenderSummaryDetail` already accepts directory output (`packages/cli/src/ui/format.ts:21-25`).

Trade-offs considered:

- **+** No extra archive write at render completion; the producer's directory remains the source of truth.
- **–** Every other route endpoint (`view`, `download`, `file/*`, `delete`) has to be widened to recognise directories.
- **–** On-disk size of a directory is the inode size; listing must report a summed byte size, not `statSync(directory).size`.

### 2. Listing payload — **filesystem discovery, sidecar cache with fallback**

Discover directory entries from the filesystem, then read `frameCount`, summed byte `size`, and `audioSidecar` from the `.meta.json` sidecar. Preserve `size` as the existing listing field name, and add `kind: "directory"` only to directory rows. If the sidecar is missing or lacks `frameCount` (including a directory copied in from the CLI), fall back to one directory scan. Skip dot-prefixed names and require `lstat` to report a real directory, not a symlink, before resolving it through `resolveWithinProject`.

- Listing avoids a directory walk for sidecar-backed renders.
- The sidecar schema remains additive; the route already ignores unknown keys (`render.test.ts:47-65`).
- Filesystem discovery keeps CLI-created directories visible even without a sidecar, and filtering dot-prefixed names prevents producer transaction staging directories from appearing.
- The footprint scan should reuse the filesystem logic in the CLI's `readOutputFootprint` helper (`packages/cli/src/commands/render.ts:1890-1916`), not the surrounding telemetry block. Extract/share that logic so the CLI summary and Studio fallback use the same definition of frame count and summed bytes.

Trade-offs considered:

- **+** Missing or incomplete metadata is recoverable with a one-time scan.
- **–** The sidecar schema gains directory facts (`frameCount`, `size`, and `audioSidecar`); readers must remain additive and tolerant of unknown fields.

### 3. Download path — **stream a STORE ZIP64 archive on demand**

Prefer a streamed STORE ZIP64 archive per download request; do not write a zip at render completion. Use a ZIP64-capable streaming writer (not `adm-zip`, which buffers archives in memory). The response emits local headers, streamed file contents, data descriptors, central directory records, and ZIP64 end records. Set `Content-Length` from the known entry sizes and record overhead so clients can show download progress.

- ZIP is the reviewer's preference because macOS and Windows open it natively. A plain streamed tar is an acceptable fallback only if a correct streaming ZIP64 implementation is not feasible; a ZIP writer without ZIP64 is not acceptable.
- STORE avoids recompressing PNGs. `deflateRaw` is not needed.
- Calculate CRC-32 while streaming and write it in the data descriptor. Do not assume `node:zlib.crc32` is present across the declared `engines: >=22` range (it was added in Node 22.2); use a compatible implementation or verify and update the supported runtime floor.
- Stream chunks from disk rather than using `readFileSync` for a whole frame. Include only validated frame files and the optional `audio.m4a`.

Trade-offs considered:

- **+** No archive is written during render completion, and memory remains bounded by the stream buffers rather than total sequence size.
- **+** Known entry sizes make a deterministic `Content-Length` possible, including for ZIP64 archives.
- **–** ZIP64 requires correct 64-bit sizes, offsets, descriptors, and end records; test archives above the classic 4 GiB limit.
- **–** Streaming downloads do not support byte-range resume. A retry starts a new archive response.

### 4. Remove + cancel — **lstat and remove validated directories**

For DELETE, add the bare `<jobId>` candidate to `resolveRenderArtifacts`, keep `/`, `\`, and NUL rejection, and remove a directory recursively only after `lstat` confirms it is a real directory and not a symlink. Return 409 immediately if the in-memory job is still rendering. During rendering the producer writes to a hidden staging sibling, so the final destination is not yet present; deleting nothing would otherwise allow the render to commit and reappear in the listing. This also closes the existing file-format delete/commit gap.

- Adapter cancellation cleanup in both hosts must also branch on `lstat`: `rmSync(path, { recursive: true, force: true })` for a real directory and the existing file cleanup for regular files. Derive and clean the metadata sidecar by job id, not by replacing an extension in `outputPath`.
- The producer rollback reference is `packages/producer/src/services/render/artifactTransaction.ts:404-415, 434-441`; the directory-output selection is in `renderOrchestrator.ts:2882-2885`.

Trade-offs considered:

- **+** Directory cleanup removes the complete artifact instead of failing silently on `unlinkSync(directory)`.
- **+** A 409 prevents DELETE from racing the producer's hidden-stage-to-final-directory commit.
- **–** A planted symlink must be rejected before recursive removal; cover this with an escaping-symlink regression test.

## Technical Design

### 1. Core Components

Two new helpers in `packages/studio-server/src/helpers/`:

```ts
// renderZipStream.ts — produces a streaming ZIP64 STORE response for a directory.
export function directoryZipResponse(dir: string, jobId: string): Response;

// renderDirectoryStats.ts — shared read-only directory footprint calculation.
export function readDirectoryRenderStats(dir: string): {
  frameCount: number;
  size: number;
  audioSidecar: boolean;
};
```

A directory-aware widening of the route's `resolveRenderArtifacts` (`render.ts:26-35`) returns either a `{ kind: "directory"; path: string }` tag or a `{ kind: "files"; paths: string[] }` tag. The directory candidate is the bare job id; the delete handler branches on the resolved artifact kind.

### 2. Data Models

```ts
// RenderJobState keeps outputPath and gains an optional kind for runtime narrowing.
type RenderJobState = { kind?: "file" | "directory"; outputPath?: string; ... };

// Existing file entries keep their shape and `size` field. Only directory rows
// add the directory discriminator and directory facts.
type RenderListingEntry =
  | { id: string; filename: string; size: number; createdAt: number; status: ...; durationMs?: number; audioLoweredDb?: number }
  | { kind: "directory"; id: string; filename: string; size: number; frameCount: number; audioSidecar: boolean; createdAt: number; status: ...; durationMs?: number; audioLoweredDb?: number };

// Only PNG-sequence is added to this route's format contract in this change.
type RenderFormat = "mp4" | "webm" | "mov" | "png-sequence";
```

### 3. Integration Points

- **Producer (unchanged input).** `executeRenderJob(job, projectDir, outputPath, ...)` works on a directory `outputPath` as is (`packages/producer/src/services/renderOrchestrator.ts:2771`).
- **Adapter contract** (`packages/studio-server/src/types.ts:164`) widens `format`; `RenderJobState.kind` is set from the resolved output artifact kind. Both adapters use a job-id-based metadata path and widen `removeCancelledOutput`.
- **In-memory job map** (`render.ts:48`): `outputPath` fields hold a directory path for `png-sequence`; `renderJobs.delete(jobId)` runs in both DELETE and the SSE-end path.
- **SSE /cancel** (`render.ts:209-218`): the cancel branch flips `state.status = "cancelled"`, then the adapter's directory-aware `removeCancelledOutput` removes both the committed directory and job-id sidecar when needed.
- **CLI telemetry** (`packages/cli/src/server/studioRenderTelemetry.ts:27-31`): today's comment becomes stale; remove "Studio has no png-sequence option" so it no longer contradicts the route.

### 4. Files Changed

> Each line range is exactly what changes. Files outside this list must not be touched by this PR.

- **`packages/studio-server/src/routes/render.ts`** — accept PNG-sequence; derive artifact kind; keep `RENDER_MIME` separate from render-artifact deletion candidates and add `.png: image/png` for individual frame serving; return 404 from `view` for directories; stream ZIP64 from `download`; gate DELETE with 409 while rendering and safely remove real directories; discover listing rows from the filesystem while skipping dot-prefixed entries.
- **`packages/studio-server/src/types.ts:161-203`** — widen the adapter format and add optional `kind?: "file" | "directory"` to `RenderJobState`.
- **`packages/studio-server/src/helpers/renderZipStream.ts`** _(new)_ — streamed STORE ZIP64 response; stream file chunks, compute CRC-32 incrementally, include ZIP64 records, and calculate `Content-Length`. Do not buffer whole frame files or use `adm-zip`.
- **`packages/studio-server/src/helpers/renderDirectoryStats.ts`** _(new or extracted shared helper)_ — return `{ frameCount, size, audioSidecar }`; share the directory-footprint logic with the CLI's existing `readOutputFootprint`.
- **`packages/studio/src/components/renders/RenderQueueItem.tsx`** — hide or disable directory video preview/open controls; route directory downloads to `/render/:jobId/download`.
- **`packages/studio/src/components/renders/RenderQueue.tsx`** — add PNG-sequence to the format selector and its format information.
- **`packages/studio/src/components/renders/renderSettings.ts`** — accept and persist PNG-sequence in render settings.
- **`packages/studio/src/components/renders/useRenderQueue.ts`** — widen render format/job types, derive the directory kind and filename, and map directory listing fields into queue jobs.
- **`packages/studio/src/components/renders/GpuEncodingToggle.tsx`** — accept the widened format type while continuing to show the GPU control only for MP4.
- **`packages/cli/src/commands/render.ts`** — reuse the shared footprint helper while retaining the CLI's formatted summary behavior.
- **`packages/studio/vite.adapter.ts:311-402`** — derive metadata sidecar from `dirname(outputPath)` and `jobId`; use `lstat` plus recursive `rmSync` for directory cancellation cleanup.
- **`packages/cli/src/server/studioServer.ts:569-692`** — same sidecar-path and directory-cancel changes as the Vite adapter.
- **`packages/studio-server/src/routes/render.test.ts`** _(new cases)_ — see Testing Strategy.
- **`packages/studio-server/src/routes/renderDeletion.test.ts`** and adapter tests — cover directory deletion, escaping symlinks, in-flight 409, and cancel cleanup after commit.
- **`packages/cli/src/server/studioRenderTelemetry.ts:27-31`** — remove the stale comment that Studio has no PNG-sequence option.

## Implementation Plan

### Phase 1 — Storage + adapter contract (foundational; the rest depends on it)

1. Widen `StudioApiAdapter.startRender.format` and add optional `RenderJobState.kind` in `packages/studio-server/src/types.ts`.
2. Accept `"png-sequence"` and resolve its artifact kind as `"directory"`; build `outputPath = join(rendersDir, jobId)`.
3. Validate the output path through `resolveWithinProject` and `!isPrivateProjectFile`.
4. In both adapter hosts, derive metadata paths from the job id in the renders directory, not `outputPath.replace(...)`; apply this to success, failure, and cancel cleanup.
5. Widen `removeCancelledOutput` in both hosts: use `lstat`, recursively remove a real directory, unlink regular files, and remove the job-id metadata sidecar. Keep the operation safe if cancellation races with commit.
6. Widen the Studio format selector, persisted settings, and `StartRenderOptions` to include PNG-sequence; keep GPU encoding restricted to MP4.

### Phase 2 — Listing endpoint (read-only; unblocks UI)

1. Discover file and directory entries from `renders/`; skip dot-prefixed names, use `lstat` to reject symlinked directories, and validate paths with `resolveWithinProject` plus `isPrivateProjectFile`.
2. Read directory metadata (`frameCount`, numeric byte `size`, `audioSidecar`) from `<jobId>.meta.json`. If it is missing or lacks `frameCount`, use the shared directory-footprint helper once.
3. Keep file listing fields unchanged. Add `kind: "directory"` only to directory rows, then sort as today.
4. Re-register on-disk directory jobs with `kind: "directory"` so they remain downloadable after restart.

### Phase 3 — Download stream

1. Implement a ZIP64-capable STORE stream; compute CRC-32 incrementally, stream file chunks, include ZIP64 records, and calculate exact `Content-Length`.
2. Wire only `GET /render/:jobId/download` to the archive response. Keep `GET /render/:jobId/view` as 404 for directories.
3. Add `.png: image/png` to frame-file MIME handling without treating `.png` as a standalone render artifact extension.
4. Hide the video preview/open action for directory entries in `RenderQueueItem`; preserve the download action using the archive endpoint.
5. Map directory listing rows into `RenderJob` with `kind: "directory"` so the queue can select the correct preview and download behavior.

### Phase 4 — DELETE + cancel

1. Extend `resolveRenderArtifacts` with the bare job-id candidate and a tagged directory/file result; keep path separator and NUL rejection.
2. Return 409 before filesystem resolution when `renderJobs.get(jobId)?.status === "rendering"`. The final destination is absent while the producer writes its hidden staging sibling; without this guard, it can commit after DELETE and reappear.
3. Remove a validated directory only when `lstat` confirms it is a real directory and not a symlink. Keep file deletion behavior unchanged.
4. Verify cancellation cleanup after a directory has committed, including its metadata sidecar; cover both adapter hosts.

### Phase 5 — Tests + observability

1. Add the route, stats, ZIP64, deletion, and adapter cancellation cases in Testing Strategy.
2. Run the focused Studio server tests and relevant adapter/Studio UI tests.
3. Update the stale comment in `packages/cli/src/server/studioRenderTelemetry.ts:27-31`.

## Implementation Feasibility

The producer already publishes directory artifacts atomically, and the route's `resolveWithinProject` / `isPrivateProjectFile` cover directory paths. The `renderJobs` map can retain one `outputPath` with an explicit artifact kind. The feedback identifies additional concrete risks:

- **ZIP64 correctness.** A custom or third-party writer must support 64-bit entry sizes, offsets, and archive end records while streaming. Do not use in-memory `adm-zip`; test the ZIP64 path and content length.
- **Node compatibility.** The package supports `engines: >=22`, while `node:zlib.crc32` requires Node 22.2+. Use an implementation compatible with the declared floor unless the runtime floor is explicitly raised.
- **Sidecar paths.** Extension-derived paths alias the output directory for extensionless renders. Both adapters must use the job id to write metadata beside the output.
- **Hidden staging and cancellation.** The directory listing must ignore dot-prefixed transaction staging directories; both adapters must remove a directory after a cancel race, not silently swallow `unlinkSync(directory)` failure.
- **Backward compatibility.** Preserve the existing file listing `size` field and file rows. Directory-only fields are additive; fallback scanning covers sidecar-free CLI artifacts.

## Decisions from feedback

### 1. Storage

Use `renders/<jobId>/`. Branch on artifact kind rather than the format string. PNG-sequence is enabled in this change; HLS can reuse the directory-aware route and adapter branches if it is later admitted by route validation.

### 2. Listing and metadata

Keep `size` as the existing numeric byte field. Add `kind: "directory"` only to directory rows, with `frameCount` and `audioSidecar`. Persist directory facts in the additive sidecar schema; if the sidecar is missing or has no `frameCount`, compute a one-time fallback from the directory. Discover rows from the filesystem, skip dot-prefixed names, and reject symlinked directories.

### 3. Download and view

Stream a STORE ZIP64 archive on demand and do not write an archive at render completion. ZIP64 is mandatory for large sequences; `Content-Length` is calculable from file stats and archive record sizes. Do not reuse `adm-zip` for frame archives because it buffers in memory. Directory view is not a playback artifact: return 404 from `/view` and hide Studio's video preview/open action. Serve individual `.png` frames as `image/png` if accessed through `/renders/file/*`.

### 4. Delete and cancel

Return 409 when the job is still rendering. The final directory is not present while the producer writes its hidden staging sibling; without the guard, the render could commit after DELETE and reappear. Extend safe artifact resolution to include the bare job id, reject traversal and symlink escapes, and recursively remove only a real directory. Adapter cancellation uses the same directory-aware cleanup and must be tested after commit.

### 5. Sidecar and explicit type decisions

Keep the sidecar additive with no version field. Derive its path from the renders directory and job id (`join(dirname(outputPath), \`${jobId}.meta.json\`)`), never by replacing an extension on `outputPath`. Add optional `kind?: "file" | "directory"`to`RenderJobState`, set from the resolved output artifact kind. Separately, preserve the listing contract by leaving file rows unchanged and tagging directory rows only with `kind: "directory"`.

## Testing Strategy

### Unit Tests

Add targeted route, helper, adapter, and Studio UI tests for the new directory shape and the feedback-identified failure modes.

In **`packages/studio-server/src/routes/render.test.ts`** add cases:

- `POST /projects/:id/render accepts "png-sequence" and hands a directory outputPath to the adapter` — assert `opts.outputPath === join(rendersDir, jobId)` and `opts.format === "png-sequence"`.
- `POST /projects/:id/render with an unknown format still defaults to mp4 (legacy behaviour)` — backward-compat.
- `POST /projects/:id/render with "png-sequence" plus a body.composition that fails resolveWithinProject is 400` — same defence as the file branch (`render.ts:132-135`).
- `GET /projects/:id/renders lists a directory with kind, frameCount, size, and audioSidecar from sidecar`.
- `GET /projects/:id/renders falls back when the sidecar is missing or lacks frameCount`.
- Listing ignores dot-prefixed transaction directories and does not follow a symlinked directory.
- A directory render returns 404 from `/view` and streams an archive from `/download`.
- A directory row uses the archive download URL and has no video preview/open action.
- `/renders/file/...png` responds with `image/png`.

In **`packages/studio-server/src/routes/renderDeletion.test.ts`** add cases (these are the gaps relative to the issue's "Done when"):

- `deletes a directory render` — write frames plus optional audio, DELETE → directory and job-id sidecar gone, `renderJobs` entry gone.
- `cannot use a job ID to delete an arbitrary nested file` — already covered for files (line 103-112); add a directory analogue that asserts `mkdir(<rendersDir>/<jobId>/nested)` is `rmSync`'d by DELETE, while `mkdir(<rendersDir>/other/nested)` is preserved.
- `rejects an escaping symlinked directory before deleting anything` — plant a symlink at `renders/<jobId>` pointing outside the project; do not remove its target.
- `DELETE while the render is still in flight returns 409`, with a regression showing the render cannot commit and reappear after a mid-render DELETE.
- `DELETE tolerates a missing renders directory and returns 200` — green-path regression (mirror of line 96-101).

In **`packages/studio-server/src/helpers/renderZipStream.test.ts`** _(new file)_:

- `emits a valid STORE ZIP64 archive with frame_NNNNNN.png × N plus optional audio.m4a`; assert stable entry ordering and no path traversal names.
- The streamed response's `Content-Length` equals the emitted body length.
- The ZIP64 record path works for sizes/offsets beyond 4 GiB without buffering a multi-gigabyte fixture.
- `rejects a directory job id whose validation does not exist in rendersDir`.

In **`packages/studio-server/src/helpers/renderDirectoryStats.test.ts`** _(new file)_:

- `counts frames with /^frame_\d{6}\.png$/, sums bytes into size, includes audio.m4a`.
- `returns audioSidecar: false when audio.m4a is absent`.

In both **`packages/studio/vite.adapter.ts`** and **`packages/cli/src/server/studioServer.ts`**, add or extend tests for:

- Metadata is written beside an extensionless directory output on success and failure, never to the frames directory.
- Cancellation after directory commit removes both the directory and the job-id metadata sidecar.

In Studio render settings and queue tests, cover PNG-sequence selection/persistence, queue mapping of a directory listing row, and hiding video preview/open controls while keeping archive download available.

Existing tests that **must not regress** (no modifications):

- `packages/studio-server/src/routes/render.test.ts:47-65` — stale-sidecar status (file shape).
- `packages/studio-server/src/routes/render.test.ts:839-840` — `format: "webm" | "mov"` for `gpu: true`.
- `packages/studio-server/src/routes/renderDeletion.test.ts:56-94` — file-shaped delete.
- `packages/studio-server/src/routes/renderDeletion.test.ts:96-101` — missing renders directory.
- `packages/studio-server/src/routes/renderDeletion.test.ts:103-134` — file-shape path-traversal.

### Integration Tests

No new end-to-end suite is required for this route change. The Studio layer's existing edit-accuracy pipeline (`packages/studio/tests/e2e/edit-accuracy/`) is for canvas edits, not renders; this change does not touch the editor's selection or relight path. Producer integration coverage already exists at `packages/producer/src/services/renderOrchestrator.test.ts:1453-1475` for the `isPngSequence` capture planning branch. Manually exercise a Studio PNG-sequence render and archive download before merge.

## Observability

### Logging

- Producer logs already cover the directory publish path (`packages/producer/src/services/render/stages/encodeStage.ts:308-310` logs the `audio.m4a` sidecar write).
- Route logs: the existing TTL cleanup timer at `render.ts:73-79` runs as today; no new logs in the new directory branch.
- One new structured log: on `DELETE /render/:jobId`, log the directory's `frameCount` at info when the deleted artifact was a directory. Through the route's existing log surface; no new logger type.

### Metrics

- Existing telemetry events flow through `packages/cli/src/server/studioRenderTelemetry.ts:27-31`. The PR removes the now-stale comment so this emitter stays clean; no new fields.
- Producer's `perfStages` (line 4359-4999) gain no new keys.

## Future Considerations

- **GIF output.** GIF is a separate file artifact, not a directory render. Accepting it requires widening format validation and file MIME handling; it does not use the PNG-sequence directory stats/archive path.
- **HLS output.** The producer already publishes HLS as a directory (`packages/producer/src/services/renderOrchestrator.ts:2882-2885`). The generic artifact-kind handling is reusable, but HLS-specific listing facts and format validation remain future work.
- **On-disk zip cache.** If a streaming-zip download becomes bandwidth-bound at a long-tail render scale, a future enhancement can introduce an opt-in `Cache-Control` byte-range zip written after completion. Today's pattern keeps the disk state minimal.
- **Sidecar schema versioning.** If the meta sidecar grows further (e.g. `frameRate`, `width`, `height`), introduce a `schemaVersion` field; today it remains forward-compatible.

## Security Considerations

- **Path traversal:** the existing `resolveWithinProject` (`packages/studio-server/src/helpers/safePath.ts:24-29`) plus `isPrivateProjectFile` (`safePath.ts:36-67`) is the gate. The same gate runs for directory outputs — no new attack surface.
- **Symlink escape:** `lstatSync` (not `statSync`) reports "is symlink" before `rmSync` is called, so a crafted directory-symlink whose target is outside `rendersDir` is rejected. Tested in `renderDeletion.test.ts:114-134` for the file case; the directory analogue lands here.
- **In-flight DELETE race:** while rendering, the producer writes to a hidden staging sibling and the final output path does not exist. Without the 409 guard, DELETE removes nothing and the producer can publish the render afterward, causing it to reappear in history.
- **Archive implementation:** do not use `adm-zip` for large frame archives because it buffers in memory. Prefer a bounded-memory ZIP64 writer; if adding a dependency, it must support streaming STORE mode and ZIP64.

## Rollout Strategy

1. **Development phase.** Implement the PR on a topic branch off `main`. Run formatting and linting, Studio server tests, relevant adapter tests, and Studio render-settings/queue tests.
2. **Testing phase.** Run the focused route, stats, ZIP64, deletion, adapter, and UI tests. Manually exercise a Studio dev server: start a PNG-sequence render from the UI, verify the listing's frame count and `size`, download and inspect the ZIP64 archive, verify directory preview is unavailable, then DELETE and verify the directory and metadata sidecar are gone.
3. **Staging.** Lambda / Cloud Run render paths are unaffected; no staging-only flags. Producer staging in normal CI verifies the producer-side unchanged.
4. **Production.** Behavioural change is additive; directory outputs were not available from Studio before. Monitor listing latency, archive-download failures, and DELETE 409/5xx rates. Telemetry events flow unchanged.
5. **Monitoring.** Existing `perfStages` capture the producer-side; the route does not log per-render. The post-merge dashboard (`packages/cli/src/server/studioRenderTelemetry.ts`) confirms the route's render funnel numbers.

## References

- Issue [#5553](https://github.com/heygen-com/hyperframes/issues/5553).
- Research: `research/issue-5553-png-sequence-route-state.md`.
- Selected proposals:
  - `research/issue-5553-proposal-01-storage.md` — Proposal 1 (folder named by job id).
  - `research/issue-5553-proposal-02-listing.md` — Proposal 2 (lazy, meta-sidecar cached).
  - `research/issue-5553-proposal-03-download.md` — Proposal 1 (stream a zip on demand).
  - `research/issue-5553-proposal-04-delete-cancel.md` — Proposal 1 (`rmSync` the validated directory).
- Producer directory-output authority: `packages/producer/src/services/render/artifactTransaction.ts:257-442`, `packages/producer/src/services/render/stages/encodeStage.ts:283-313`, `packages/producer/src/services/renderOrchestrator.ts:2868-2890`.
- CLI precedent (already handles directory output): `packages/cli/src/commands/render.ts:181-188, 1892-1902`, `packages/cli/src/commands/render/plan.ts:42-62`, `packages/cli/src/ui/format.ts:21-25`.
- Path-safety helpers: `packages/studio-server/src/helpers/safePath.ts:24-79`.
- Existing tests for delete: `packages/studio-server/src/routes/renderDeletion.test.ts:56-134`.
