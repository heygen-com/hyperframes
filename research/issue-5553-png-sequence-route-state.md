# GitHub issue #5553 — `Studio render route: support PNG-sequence output`: codebase state today

Research document for issue [heygen-com/hyperframes#5553](https://github.com/heygen-com/hyperframes/issues/5553). Captures the existing render-route surface and where it diverges from a directory-shaped deliverable. No fixes are proposed — the document only describes what is in the tree on `main`.

## Summary

PNG-sequence is already a first-class output in the **producer** (`packages/producer`) but the **Studio render route** (`packages/studio-server/src/routes/render.ts`) was written against single-file deliverables and has no notion of a directory output. Every endpoint in that route — start, list, file-serve, view, download, delete, cancel — uses file-shaped assumptions: extension whitelists, `isPlainFile` checks, `readFileSync`, `unlinkSync`, and `RENDER_ARTIFACT_EXTENSIONS`. The two adapter implementations (`packages/studio/vite.adapter.ts` and `packages/cli/src/server/studioServer.ts`) share the same file-only cleanup pattern. The shared path-safety helpers in `packages/studio-server/src/helpers/safePath.ts` already defend against path-traversal on file paths and can be reused for directory paths once the route is widened. The narrowest in-scope change is to `packages/studio-server`; the CLI and Vite adapters need their cleanup paths widened to match.

## Issue pointer (verbatim where it shapes the search)

- `Where to look`: `packages/studio-server/src/routes/render.ts`, `packages/cli/src/server/studioServer.ts`, `packages/studio/vite.adapter.ts`. `done when`: a PNG-sequence render can be listed, downloaded, deleted from Studio; cancel leaves nothing behind; route tests cover the directory case including a path-traversal attempt on delete.
- `Related`: GIF output from Studio is described as a "smaller version of the same widening".

## Component map and current state

### `packages/studio-server/src/routes/render.ts` — the route the issue targets

**Render jobs live in-process.** Each Hono app holds a `Map<string, RenderJobState & { createdAt: number }>`. A TTL cleanup interval prunes finished jobs after 5 minutes in non-production builds (`packages/studio-server/src/routes/render.ts:46-81`). The map is keyed by `jobId` and stores a single `outputPath` per job.

**Format whitelist is hard-coded to mp4/webm/mov.** The route validates the request body against `["mp4", "webm", "mov"]` and falls back to `mp4` for unknown values (`packages/studio-server/src/routes/render.ts:111-113`). The adapter contract downstream matches the same union (`packages/studio-server/src/types.ts:164`):

```
format: "mp4" | "webm" | "mov";  // packages/studio-server/src/types.ts:164
```

**Output path is built as a file.** `mkdirWithinProject` ensures the renders dir exists; `outputPath` is then `join(rendersDir, `${jobId}${ext}`)` with a fixed extension map (`packages/studio-server/src/routes/render.ts:149-154`):

```
const FORMAT_EXT: Record<string, string> = { mp4: ".mp4", webm: ".webm", mov: ".mov" };
const ext = FORMAT_EXT[format] ?? ".mp4";
const outputPath = join(rendersDir, `${jobId}${ext}`);
```

This is the file-shaped assumption: `jobId` becomes the basename of a file.

**`/render/:jobId/view` and `/render/:jobId/download` are readFileSync on a single file** (`packages/studio-server/src/routes/render.ts:235-271`). Both gate on `isPlainFile(job.outputPath)` (defined inline at line 220) and 404 if the output is missing or is not a regular file. The MIME map only covers `mp4`, `webm`, `mov` (`packages/studio-server/src/routes/render.ts:18-22`).

**`/projects/:id/renders` listing filters to file extensions.** Reads `rendersDir` and filters for `*.mp4 | *.webm | *.mov`, computes `rid = filename.replace(/\.(mp4|webm|mov)$/, "")`, then loads `${rid}.meta.json` sidecar for completion state (`packages/studio-server/src/routes/render.ts:325-369`). Returns no `frameCount`, `totalSizeOfDirectory`, or directory entries.

**`/projects/:id/renders/file/*` is an in-memory-map-independent file serve** (`packages/studio-server/src/routes/render.ts:299-323`). Routes `jobId` directly through `resolveWithinProject(rendersDir, filename)` so symlinks inside `rendersDir` cannot escape; same `RENDER_MIME` and `content-type` mapping as the view/download routes.

**DELETE uses an extension whitelist via `resolveRenderArtifacts`.** Each candidate path is `resolveWithinProject(directory, `${jobId}${extension}`)` for `extension` in `[...mp4, webm, mov, meta.json]` (`packages/studio-server/src/routes/render.ts:26-35, 281-296`). Anything missing returns `"forbidden"`. The jobId is also explicitly checked against `/`, `\`, `\0` (line 284). The route then `unlinkSync`'s whatever exists; for `png-sequence` this loop would be invalid because the deliverable is a directory, not files. `renderJobs.delete(jobId)` is the only book-keeping after unlink.

**`/render/:jobId/progress` is an SSE stream from the in-process map** (`packages/studio-server/src/routes/render.ts:180-205`) — no broadcast, no subscribers, single-reader. After the map forgets the job (TTL cleanup, restart, or successful manual delete), the stream 404s.

**Cancel posts an abort signal into the adapter** (`packages/studio-server/src/routes/render.ts:209-218`). The `cancel` hook lives on the `RenderJobState` returned by the adapter. Whether anything on disk is cleaned up depends entirely on the adapter — the route itself does not touch disk on cancel.

#### Tests around delete

`packages/studio-server/src/routes/renderDeletion.test.ts` covers the file-only delete assumptions and the path-traversal defenses that already exist:

| Test                                                      | What it asserts                                                                                       |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `deletes a cached render and its metadata`                | Ok on a missing-project case (line 56-66).                                                            |
| `deletes expired artifacts permanently`                   | Three extensions and `.meta.json` all go; sibling renders left alone (lines 68-94).                   |
| `returns success without recreating a missing render dir` | DELETE tolerates a vanished `rendersDir` (lines 96-101).                                              |
| `cannot use a job ID to delete an arbitrary nested file`  | `nested/keep` → 403 (lines 103-112).                                                                  |
| `rejects escaping artifact symlinks before deleting`      | `.meta.json` symlink to `outside.json` → 403, source preserved (lines 114-134, Windows CI skip path). |

### `packages/studio-server/src/helpers/safePath.ts` — shared path-safety helpers

Plugin upstream of every route. Re-exports `isSafePath`, `realpath`, `realProjectRoot`, `mkdirWithinProject`, `folderGone` from `@hyperframes/core/safe-path`, then layers project-relative helpers on top:

- `resolveWithinProject(base, relativePath)` — delegates to core's resolver and refuses `isPrivateProjectFile(base, resolved)` (`packages/studio-server/src/helpers/safePath.ts:24-29`).
- `isPrivateProjectFile(projectDir, filePath)` — checks the (resolved, realpath) relative path against `isPrivateProjectPath`, which classifies any `.hyperframes/` subtree except Studio's own files (`packages/studio-server/src/helpers/safePath.ts:52-64, 36-50`). This is what blocks a crafted `jobId` like `../../foo.webm` from escaping `rendersDir`.
- `pinWithinProject(base, relativePath)` — same as resolveWithinProject but also re-resolves after the initial pass so retargeted symlinks between resolve and write can't escape (`packages/studio-server/src/helpers/safePath.ts:71-79`).
- `walkDir(dir, prefix)` — used by `compositionsAffectedBy` and project lint scan; ignores `.thumbnails`, `.transcode-cache`, `.waveform-cache`, `node_modules`, `.git` plus `.hyperframes/backup` by relative path (`packages/studio-server/src/helpers/safePath.ts:81-110`). Nothing in this helper changes for a PNG-sequence render because the directory lives inside `renders/` (which is not in `IGNORE_DIRS`).

`safePath.test.ts` only covers `walkDir` and `isPrivateProjectFile`. The DELETE-route path-safety coverage lives in `renderDeletion.test.ts` (above) — there is no existing directory-traversal test for delete, which is the gap the issue's "Done when" calls out.

### `packages/studio-server/src/types.ts` — adapter contract

The `StudioApiAdapter.startRender` opts only declare a three-member union for format:

```
format: "mp4" | "webm" | "mov";  // types.ts:164
```

`renderJobs` declared as `Map<string, RenderJobState & { createdAt: number }>`. `RenderJobState` is a single object with one `outputPath` field (`types.ts:15`-ish). There is no per-job directory discriminator today.

### `packages/producer/src/services/renderOrchestrator.ts` — png-sequence already works end-to-end

The orchestrator already recognises four non-`file` outputs: `mp4`, `webm`, `mov` (file), and `png-sequence` / `gif` / `hls` (directory). The discrimination happens in `executeRenderPipeline` (`packages/producer/src/services/renderOrchestrator.ts:2868-2890`):

```
const outputFormat = job.config.format ?? ("mp4" as const);
const isPngSequence = outputFormat === "png-sequence";
const isGif = outputFormat === "gif";
const isHls = outputFormat === "hls";
…
const artifactTransaction = new ArtifactTransaction(
  outputPath,
  isPngSequence || isHls ? "directory" : "file",
);
const stagedOutputPath = artifactTransaction.stagingPath;
```

So when the producer is reached with `format: "png-sequence"`, `outputPath` **is the directory** that contains the frames. The same `executeRenderJob` call signature (`executeRenderJob(job, projectDir, outputPath, …)`) used by both adapters works unchanged. The route contract change is the only thing standing between Studio and an existing producer capability.

Other orchestration touchpoints (all pre-existing, no change needed):

- **Capture planning**: streaming encode is explicitly disabled for png-sequence — `shouldUseStreamingEncode(...)` returns `{ enabled: false, reason: "format_excluded" }` (line 1475). Capture falls back to the screenshot/disk path.
- **Layered composite**: forced layered-composite path is dropped when `isPngSequence` is true (line 4178). Alpha capture is on by the format itself.
- **File extension table** inside `executeRenderJob`: `FORMAT_EXT["png-sequence"] = ""` (line 4125) so the `videoOnlyPath` placeholder stays well-formed for code that asks for it. The encode stage for png-sequence does not write `videoOnlyPath` at all.
- **Stage-6 assemble** is **skipped** for png-sequence and gif, kept for hls (`packages/producer/src/services/renderOrchestrator.ts:5015-5043`): comment in the file calls this out — "png-sequence is a directory deliverable, and gif is written directly to `outputPath` by the two-pass palette encoder. hls is a directory deliverable but still runs this stage — the HLS packaging IS its assemble step."

#### `ArtifactTransaction` — directory-mode atomicity

`packages/producer/src/services/render/artifactTransaction.ts` is the producer's staged-write machinery and is the source of truth for "is this output a file or a directory?".

- Constructor: `new ArtifactTransaction(destinationPath, kind, fileSystem?, durationProbe?)`. `kind: "file" | "directory"` (`artifactTransaction.ts:257-276`).
- Staging side: `this.stagingPath = join(this.transactionDirectory, basename(this.destinationPath))` (line 273). For a directory destination, the staging side is **also a directory** (basename of `/path/to/<jobId>` is `<jobId>`). The transaction directory layout is `<renders-dir>/__transactions__/<jobId>.txn/<jobId>`.
- `commit()` (lines 363-402) has two branches:
  - **No existing destination, or file destination** → single `renameSync(stagingPath, destinationPath)`.
  - **Existing directory destination**: portable Node fs cannot atomically replace a non-empty directory, so it does `renameSync(destination, backupPath)` then `renameSync(stagingPath, destination)`; on failure of the second rename, restores the backup through `restoreBackupIfDestinationUnclaimed` (lines 386-398, 417-432). The inline comment at 381-385 says "Portable Node filesystem APIs cannot atomically replace a non-empty directory. Keep the backup handoff for an existing PNG-sequence output; it provides recovery on ordinary errors, but not atomic visibility or crash recovery. Callers should publish directory outputs to a fresh path when they require the same visibility guarantee as file artifacts."
- `rollback()` (lines 404-415) `rmSync(stagingPath, { recursive: true, force: true })`. Already directory-safe; nothing extra needed to call it with a directory `stagingPath`.
- `validate()` (lines 278-286) for `"directory"` calls `assertReadableNonEmptyDirectory` and, if `expected.requiredFiles` are given, asserts each one is non-empty. For png-sequence in particular `expected.probeTarget` is undefined, so duration probing is dropped — comment at lines 305-307 spells this out: "A directory has no single probe target, so an expectation without `probeTarget` (png-sequence) keeps the historical behavior: structure only."
- Tests already cover directory flows: `artifactTransaction.test.ts` validates directory commit (`mkdirSync(transaction.stagingPath) + frame_000001.png`, etc.), `validate()` on empty directories, the backup-handoff path on a rename failure, concurrent publishers. See e.g. line 123 (`mkdirSync(transaction.stagingPath)` + `frame_000001.png`).

#### `encodeStage` — actual png-sequence write

`packages/producer/src/services/render/stages/encodeStage.ts` is the only writer that mutates a directory today:

```
if (isPngSequence) {
  // Stage 5 (png-sequence): copy captured PNGs to outputDir
  // No encoder, no mux, no faststart — captured frames already carry
  // alpha and are the deliverable. We rename to `frame_NNNNNN.png`
  // (zero-padded) so consumers (After Effects, Nuke, Fusion, ffmpeg
  // image2 demuxer) can globbed-import without surprises.
  const encoded = startEncodeProgress(job, "Writing PNG sequence", onProgress);
  if (!existsSync(outputPath)) mkdirSync(outputPath, { recursive: true });
  const captured = readdirSync(framesDir)
    .filter((name) => name.endsWith(".png"))
    .sort();
  if (captured.length === 0) {
    throw new Error("[Render] png-sequence output requested but no PNGs were captured to ${framesDir}");
  }
  captured.forEach((name, i) => {
    const dst = join(outputPath, formatExportFrameName(i, "png"));
    copyFileSync(join(framesDir, name), dst);
  });
  if (hasAudio && audioOutputPath && existsSync(audioOutputPath)) {
    copyFileSync(audioOutputPath, join(outputPath, MIXED_AUDIO_FILENAME));
    log.info(`[Render] png-sequence: ${MIXED_AUDIO_FILENAME} sidecar written to ${outputPath}/${MIXED_AUDIO_FILENAME}`);
  }
  encoded();
  return { encodeMs: Date.now() - stage5Start };
}
```

(`packages/producer/src/services/render/stages/encodeStage.ts:283-313`)

`formatExportFrameName` lives in `packages/producer/src/utils/paths.ts:119-121`:

```
export function formatExportFrameName(index: number, ext: string): string {
  return `frame_${String(index + 1).padStart(6, "0")}.${ext}`;
}
```

— 1-indexed, zero-padded to 6 digits, so on disk a render is `frame_000001.png`, `frame_000002.png`, …, plus `audio.m4a` in the same dir if the composition has audio. `MIXED_AUDIO_FILENAME = "audio.m4a"` comes from `packages/engine/src/services/audioMixer.ts:64` and is re-exported from `@hyperframes/engine`.

The screenshot capture path is already alpha-preserving for png-sequence — see `compileStage` resolution of `forceScreenshot`, and the comment in `renderOrchestrator.ts:4113-4116` that notes the encode+mux+faststart stages are skipped entirely for png-sequence, so `outputPath` is the dir.

### `packages/studio/vite.adapter.ts` — Studio's dev-server adapter (one of two hosts of the route)

`startRender` is implemented at `packages/studio/vite.adapter.ts:311-402`. The output path is whatever the route handed in (currently `${jobId}.mp4` etc.) and flows into:

- Producer invocation: `createRenderJob({ … format: opts.format, … })` followed by `executeRenderJob(job, opts.project.dir, opts.outputPath, onProgress, abortController.signal)` (lines 346-366). This call already supports a directory `outputPath` (see producer section above) without any change here.
- `removeCancelledOutput()` cleanup (lines 322-336) only handles a single file and its `.meta.json`:

  ```
  const removeCancelledOutput = () => {
    state.status = "cancelled";
    for (const fp of [
      opts.outputPath,
      opts.outputPath.replace(/\.(mp4|webm|mov)$/, ".meta.json"),
    ]) {
      try { if (existsSync(fp)) unlinkSync(fp); } catch { /* ignore */ }
    }
  };
  ```

  This needs to be widened for png-sequence: the cleanup target is a **directory**, not a file, and the meta sidecar lives next to the directory or at `dirname(outputPath) + "/" + basename(outputPath) + ".meta.json"`, depending on where the route writes it.

The adapter's `rendersDir` returns `resolve(dataDir, "../renders")` (`vite.adapter.ts:309`). Png-sequence jobIds carrying `/`, `\`, or `\0` would have to be rejected by the route (the current route already does this at `render.ts:284`); the adapter itself doesn't.

### `packages/cli/src/server/studioServer.ts` — CLI's adapter (other host)

Mirrors `vite.adapter.ts`'s `startRender` and `removeCancelledOutput` exactly:

- `startRender`: `cli/src/server/studioServer.ts:569-692`.
- `removeCancelledOutput` (lines 596-610) has the same two-element loop over the file and its `.meta.json` sidecar as the Vite adapter. Same change needed.

The CLI's `rendersDir` is `join(projectDir, "renders")` (`studioServer.ts:567`), keeping the job ID scoped to per-project renders the same way the Vite adapter does.

The CLI route additionally runs diagnostics via `inFlightRenders` (line 687-689), but it is unrelated to the directory-shaped cleanup.

### `packages/cli/src/commands/render.ts` and plan layer — CLI flow that already supports png-sequence

Worth recording as the in-tower reference for "png-sequence outputPath semantics":

- `packages/cli/src/commands/render.ts:181-188` — the CLI's render command schema lists `png-sequence` as a valid `format`, alongside `mp4 | webm | mov | gif | hls`.
- `packages/cli/src/commands/render.ts:1892-1902` — already formats `isDirectory: true` against `statSync(outputPath)`. Comment: "png-sequence and hls write a directory; sum contained file sizes so the user sees the deliverable footprint, not the directory inode size." This is the canonical pattern for the Studio UI's "size" column.
- `packages/cli/src/commands/render/plan.ts:42-62` — the plan's `RENDER_FORMATS` and `FORMAT_EXT` tables include `png-sequence: ""` and `hls: ""` with the comment "Directory output, like png-sequence: playlists and .ts segments go inside." The plan already treats directory output correctly.
- `packages/cli/src/ui/format.ts:21-25` — UI already knows the difference: "Directory (png-sequence) output has no single muxed video, so it shows a frame count instead, or just the render time when neither is known. An HLS playlist directory does play as one continuous video, so it reports a duration." (`packages/cli/src/ui/format.test.ts:142` covers `formatRenderSummaryDetail` for png-sequence.)
- `packages/cli/src/telemetry/events.ts:218-221` — `outputFormat` already accepts `"gif" | "png-sequence"`. The Studio-side telemetry emitter in `packages/cli/src/server/studioRenderTelemetry.ts:27-31` says "Studio has no gif/png-sequence option and createRenderJob never receives an hdrMode or videoFrameFormat from the Studio request type" — that comment will go stale the moment the route is widened.

So the CLI is fully prepared for png-sequence today; the gap is exclusively in the Studio route.

## Cross-component data flow

The end-to-end flow today, for `POST /projects/:id/render` with `format: "mp4"` (everything file-shaped):

1. **Route** (`packages/studio-server/src/routes/render.ts:84-177`) — parse body, validate, build `jobId = "${project.id}_${formatRenderOutputTimestamp(now)}"`, build `outputPath = join(rendersDir, "${jobId}.mp4")`, call `adapter.startRender({ project, outputPath, format, fps, quality, jobId, … })`, store the returned state.
2. **Adapter** (`packages/studio/vite.adapter.ts:311-402` or `packages/cli/src/server/studioServer.ts:569-692`) — wraps `createRenderJob` + `executeRenderJob`. The producer's `ArtifactTransaction("file")` does atomic rename from staging to `outputPath`. On success the adapter writes `${outputPath.replace(/\.(mp4|webm|mov)$/, ".meta.json")}` with `{ status: "complete", durationMs, audioLoweredDb? }`.
3. **SSE progress**: `/render/:jobId/progress` loops `state.progress` every 500ms.
4. **Cancel**: `/render/:jobId/cancel` sets `state.status = "cancelled"` and calls `cancel?.()` (the `AbortController` on the running job).
5. **List**: `/projects/:id/renders` reads `rendersDir`, filters extensions, joins with sidecars. Re-registers on-disk results back into the in-memory map.
6. **Serve**: `/projects/:id/renders/file/*` and `/render/:jobId/view|download` `readFileSync` on `outputPath`.
7. **Delete**: `/render/:jobId` builds a deterministic artifact list and `unlinkSync`'s each.

For png-sequence, the only divergence the producer can already handle is step 2 (`outputPath` becomes a directory). Everything before and after needs adjustment:

| Step | Today's assumption                                         | png-sequence requirement                                                                       |
| ---- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1    | Whitelist `['mp4','webm','mov']`, extension map unix-style | Accept `"png-sequence"`, treat `outputPath` as `join(rendersDir, jobId)` (no extension)        |
| 2    | `removeCancelledOutput` = unlink 2 paths                   | Cleanup = rmSync the directory (and any sibling `.meta.json` the route wrote)                  |
| 5    | Filter files by video extensions, return `size`            | Walk `rendersDir` to discover `${jobId}/` directories; report `frameCount`, summed frame-bytes |
| 6    | Read a file with content-type                              | Either zip-and-stream for download, or reject download until a delivery format is decided      |
| 7    | Unlink a list of files                                     | `rmSync` the directory, plus path-traversal safe by reusing `resolveWithinProject` for `jobId` |

`jobId` validation in the route already rejects `/`, `\`, `\0` (`render.ts:284`). Combined with `resolveWithinProject(rendersDir, jobId)` from `safePath.ts`, a PNG-sequence jobId can never escape `rendersDir` even before name validation, because the resolve re-canonicalizes with `realpath` and the `.hyperframes/` is still private. The tests the issue's "Done when" calls out — a path-traversal attempt on delete — produce a 403 in the file case today (`renderDeletion.test.ts:103-112, 114-134`); the same defense is what gates the directory case once the route is widened.

## Where the changes land (current ownership, no recommendations)

Touchpoints confirmed by the existing code. Each row is one place that mentions or shapes `jobId + outputPath` semantics; the column tells which call site would have to change to support png-sequence.

| File                                                                                                                                                                                                                                        | Role today                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/studio-server/src/routes/render.ts`                                                                                                                                                                                               | All five endpoints; format whitelist, `RENDER_MIME`, `RENDER_EXTENSIONS`, `RENDER_ARTIFACT_EXTENSIONS`, `resolveRenderArtifacts`, `isPlainFile`, `renderDirectories`. |
| `packages/studio-server/src/types.ts`                                                                                                                                                                                                       | `StudioApiAdapter.startRender` `format` union; `RenderJobState.outputPath`.                                                                                           |
| `packages/studio-server/src/helpers/safePath.ts`                                                                                                                                                                                            | `resolveWithinProject`, `isPrivateProjectFile`, `pinWithinProject` — **already directory-safe**, no change needed if used correctly.                                  |
| `packages/studio-server/src/routes/renderDeletion.test.ts`                                                                                                                                                                                  | File-only delete tests; missing directory case.                                                                                                                       |
| `packages/studio/vite.adapter.ts:311-402`                                                                                                                                                                                                   | `startRender` + `removeCancelledOutput` (file loop).                                                                                                                  |
| `packages/cli/src/server/studioServer.ts:569-692`                                                                                                                                                                                           | Same shape as vite adapter; same change shape.                                                                                                                        |
| `packages/cli/src/server/studioRenderTelemetry.ts:27-31`                                                                                                                                                                                    | Comment confirming Studio has no png-sequence today; will become inaccurate when route widens.                                                                        |
| `packages/producer/src/services/renderOrchestrator.ts:2868-2890, 4113-4129, 5015-5043`                                                                                                                                                      | Producer already supports directory output; no producer change required.                                                                                              |
| `packages/producer/src/services/render/stages/encodeStage.ts:283-313`                                                                                                                                                                       | PNG-sequence branch is upstream of the route change.                                                                                                                  |
| `packages/producer/src/services/render/artifactTransaction.ts:257-442`                                                                                                                                                                      | `kind: "directory"` semantics already validated and tested.                                                                                                           |
| `packages/producer/src/utils/paths.ts:119-121`                                                                                                                                                                                              | `formatExportFrameName` = `frame_NNNNNN.png` (1-indexed).                                                                                                             |
| `packages/engine/src/services/audioMixer.ts:64`                                                                                                                                                                                             | `MIXED_AUDIO_FILENAME = "audio.m4a"`.                                                                                                                                 |
| `packages/cli/src/commands/render.ts:181-188, 1892-1902`, `packages/cli/src/commands/render/plan.ts:42-62`, `packages/cli/src/ui/format.ts:21-25`, `packages/cli/src/ui/format.test.ts:142`, `packages/cli/src/telemetry/events.ts:218-221` | CLI side — directory-shaped output is already a solved problem here.                                                                                                  |

## Constraints the existing code already enforces

- **Atomicity**. `ArtifactTransaction` cannot atomically replace an existing directory in a portable way; the response on a same-jobId retry is "best-effort, with backup handoff" (`artifactTransaction.ts:381-385`). Studio's render job is keyed by `jobId = project.id + "_" + formatRenderOutputTimestamp(now)` (`render.ts:150`); same-timestamp retries are rare but the backup-restore is the model.
- **`.hyperframes/` private paths cannot leak**. `isPrivateProjectFile` already treats `${rendersDir}/.hyperframes/...` as private, but PNG-sequence only writes under `rendersDir/<jobId>/`, never under `.hyperframes/`. New code must avoid creating subfolders of `rendersDir` that begin with `.`.
- **Recursive cleanup safety**. `walkDir` already skips `.thumbnails`, `.transcode-cache`, `.waveform-cache`, `node_modules`, `.git`, `.hyperframes/backup` (`safePath.ts:82-95`). If png-sequence cleanup walks `rendersDir`, none of those filters bite (anything under `renders/` is in scope).
- **Format union in producer is wider than in studio**. `RenderOutputFormat` in `packages/producer/src/services/renderOrchestrator.ts:343-360` documents all six formats. Studio's route + adapter contract only exposes three. The route's `validate` function in the producer (`packages/producer/src/services/renderOrchestrator.ts:2868`) treats anything that isn't `"mp4" | "webm" | "mov" | "gif" | "hls"` as a non-png sequence; the studio route must widen its whitelist before this matches.
- **Composer test runner**. From `packages/studio/AGENTS.md`: studio is **vitest**, not `bun test`; safePath tests live under `packages/studio-server`, which uses vitest too (`packages/studio-server/vitest.config.ts`).

## Notes for whoever implements this (from the issue's "design question")

These are the four questions the issue asks the PR to answer before code is written; no answer is recorded here, only what the existing code says is hard-coded:

1. **Storage** — the producer's directory-write model (`encodeStage.ts:283-313`, `artifactTransaction.ts:281-298`) is the source shape. The route in `packages/studio-server/src/routes/render.ts:154` currently passes `outputPath = join(rendersDir, '${jobId}.mp4')`; for png-sequence the analogous call would be `outputPath = join(rendersDir, jobId)` with no extension.
2. **Listing** — `GET /projects/:id/renders` at `render.ts:325-369` is the single place that surfaces renders to the Studio UI; it filters `*.mp4 | *.webm | *.mov` and reports `size` from `statSync(fp).size`. For a directory, `statSync` returns the inode size, not the deliverable footprint — the CLI comment at `packages/cli/src/commands/render.ts:1894-1896` describes the right approach: sum contained file sizes.
3. **Download** — `/render/:jobId/view|download` (`render.ts:235-271`) currently `readFileSync` synchronously. For a directory, the issue explicitly flags "stream a zip on demand, or serve the zip written at completion" as open.
4. **Delete** — `DELETE /render/:jobId` at `render.ts:281-296` extends `unlinkSync` to a fixed list of extensions. For a directory the issue asks that `resolveWithinProject` / `isPrivateProjectFile` from `packages/studio-server/src/helpers/safePath.ts` be reused, and that the issue's "Done when" is a path-traversal test on delete (no such test exists today).

## Open test gaps relative to the issue's "Done when"

Already covered:

- DELETE returns `success without recreating a missing render directory` (`renderDeletion.test.ts:96-101`).
- `cannot use a job ID to delete an arbitrary nested file within the render directory` — Traversal-style refusal for `nested/keep` (`renderDeletion.test.ts:103-112`).
- `rejects escaping artifact symlinks before deleting anything` — symlink escape (`renderDeletion.test.ts:114-134`).

Not yet covered (gaps relative to the issue's done-when):

- A directory-shaped render artifact: list, view, download, delete, cancel.
- A path-traversal attempt on a directory render (e.g. `..` job id when `rendersDir` contains a directory).

## What is not in scope for "today's state"

- No recommendations, refactors, or design opinions in this document.
- No comments on naming, ergonomics, or migration order.
- Studio UI behavior, the `<hyperframes-player>` integration, and the player-internalized timeline representation are out of scope: this document is limited to the wire path the render route owns.
- Distributed / Lambda / Cloud Run render paths exist in `packages/aws-lambda`, `packages/gcp-cloud-run`, and `packages/producer/services/distributed`; the in-tower CLI / Studio route does not currently invoke them. They are mentioned here only as context — the issue is exclusively about the Studio render route.

## References

- Issue: <https://github.com/heygen-com/hyperframes/issues/5553>
- Producer orchestration: `packages/producer/src/services/renderOrchestrator.ts`
- Producer directory-write machinery: `packages/producer/src/services/render/artifactTransaction.ts`
- Producer PNG-sequence encode branch: `packages/producer/src/services/render/stages/encodeStage.ts:283-313`
- Studio render route: `packages/studio-server/src/routes/render.ts`
- Studio render router safety helpers: `packages/studio-server/src/helpers/safePath.ts`
- Studio render deletes tests: `packages/studio-server/src/routes/renderDeletion.test.ts`
- Studio Vite adapter: `packages/studio/vite.adapter.ts:311-402`
- CLI StudioServer adapter: `packages/cli/src/server/studioServer.ts:569-692`
- CLI plan / commands / UI for png-sequence today: `packages/cli/src/commands/render.ts`, `packages/cli/src/commands/render/plan.ts`, `packages/cli/src/ui/format.ts`
