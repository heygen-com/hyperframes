# PR title

```
feat(studio-server): support png-sequence from the Studio render route (#5553)
```

---

# PR body

> **Status: implementation, ready for review.** This carries out the design recorded in
> `plans/issue-5553-png-sequence-route.md`, with the five decisions the maintainer called in
> `plans/feedback/2026-10-14-issue-5553-png-sequence-route.md`.

## What

Studio's render route now accepts `format: "png-sequence"` and hands the producer a directory
rather than a single file, the way the producer and the CLI have always treated that format. A
finished PNG-sequence render shows up as a directory row in the render panel: a PNG badge and a
frame count instead of a video thumbnail, "Download as ZIP" instead of "Download", and no
"open in a new tab" control, because there is no single playable file. Downloading streams the
directory as an archive, so nothing is written twice.

## Why

Before this change every part of the route was single-file-shaped, while the producer's
directory writer was already the source of truth:

- Request validation accepted only `mp4`, `webm` and `mov`, and the output path was built as
  `renders/<jobId>.mp4` with the extension swapped per format.
- DELETE's artifact whitelist was `*.mp4 | *.webm | *.mov | *.meta.json`, and both adapter hosts
  derived the meta sidecar by replacing that extension.
- The listing endpoint filtered `readdirSync` to those three extensions, so a directory render had
  no row at all.
- `StudioApiAdapter.startRender`'s format union in `packages/studio-server/src/types.ts` was the
  same three-member shape, so an adapter could not be asked for the format in the first place.

Asking for `format: "png-sequence"` therefore produced an invisible render, a download endpoint
that 404s, and a DELETE that tried to unlink a path that never existed.

## Related work

- Fixes heygen-com/hyperframes#5553
- Design record: `plans/issue-5553-png-sequence-route.md`
- Maintainer feedback this resolves: `plans/feedback/2026-10-14-issue-5553-png-sequence-route.md`,
  checked against `main` at `9b996059`. The comment did not include a Studio PNG-sequence render run.
- Producer directory publish: `packages/producer/src/services/renderOrchestrator.ts` selects the
  directory transaction, and `packages/producer/src/services/render/stages/encodeStage.ts` writes
  `frame_NNNNNN.png` plus the optional `audio.m4a`.
- CLI directory output is the precedent for the listing and delivery shape:
  `packages/cli/src/commands/render.ts`.
- Path safety reuses the existing helpers: `resolveWithinProject` and `isPrivateProjectFile` in
  `packages/studio-server/src/helpers/safePath.ts`.

## Decisions

1. **Storage — `renders/<jobId>/`.** The route and both adapter hosts branch on the artifact
   _kind_, not on `format === "png-sequence"`, so directory handling stays format-agnostic and
   usable by a future directory-producing format.
2. **Listing — file rows unchanged.** Directory rows alone add `kind: "directory"`, `frameCount`
   and `audioSidecar`, and keep `size` numeric as a summed directory footprint. Entries come from
   disk, dot-prefixed producer staging names are skipped, and symlinked directories are rejected.
   Directory facts are cached in the meta sidecar, with a directory scan as the fallback when the
   sidecar is missing or incomplete.
3. **Download — STORE ZIP64 streamed on demand.** No archive is written at render completion;
   `Content-Length` is computed from the known entries and PNG bytes are stored, not re-deflated.
   In-memory `adm-zip` is not used for render frames. `/render/:jobId/view` returns 404 for a
   directory and Studio hides the preview control; individual frames are served as `image/png`.
4. **DELETE — 409 while the render is active.** The producer stages directory output in a hidden
   sibling and only publishes at commit, so the final path does not exist during the render; a
   DELETE that reported success there would see the render reappear in history. Cancelled and
   failed renders still delete with 200, removing a validated real directory recursively.
5. **Sidecar — additive, no version field.** `frameCount`, `size` and `audioSidecar` are new
   optional keys, and the sidecar path is built from the renders directory and job id instead of
   replacing an extension on the output path.

Type decisions carried from the design record: `RenderJobState` gains an optional
`kind?: "file" | "directory"`, set at render start; existing file listing rows keep their shape.

## What landed

- **Route** (`packages/studio-server/src/routes/render.ts`): format validation and a `FORMAT_KIND`
  map, kind-aware artifact resolution that also considers the bare job-id directory candidate,
  `lstat`-guarded recursive removal, directory download, and listing rows for directories.
- **Helpers**: `renderArtifactFs.ts` (artifact discovery, metadata path, removal),
  `renderDirectoryStats.ts` (frame count and summed footprint, exported as the
  `render-directory-stats` subpath), `renderZipStream.ts` (STORE ZIP64 on-demand stream), and
  `contentDisposition.ts` (the header pair the route and download share).
- **Adapters**: `packages/cli/src/server/studioServer.ts` and `packages/studio/vite.adapter.ts`
  accept the format, widen cancel cleanup to a directory plus its sidecar, and record the
  directory facts in the sidecar. Render telemetry accepts the fourth format.
- **Studio UI**: `renderSettings.ts` widens the persisted format union, `RenderQueue.tsx` adds the
  PNG sequence option (fixed-quality, like MOV), and `RenderQueueItem.tsx` renders the directory
  row and the ZIP download.
- **Tests**: new suites for the ZIP stream, directory stats, artifact filesystem helpers and the
  directory route (`packages/studio-server/src/helpers/*.test.ts`,
  `packages/studio-server/src/routes/renderDirectory.test.ts`), plus Studio rows
  (`RenderQueueItem.test.tsx`, `useRenderQueueDirectory.test.tsx`) and the CLI adapter test.

## Testing

- **Manual end-to-end run** against a real Studio server (`hyperframes preview`), rendering a
  two-frame PNG sequence: the listing reported `kind: "directory"` with `frameCount: 2` and a
  summed `size`; `renders/<jobId>/` held `frame_000001.png` and `frame_000002.png`;
  `/render/:jobId/view` returned 404; `/render/:jobId/download` streamed `application/zip` with a
  computed `Content-Length` that `unzip -t` accepted as a valid archive; and DELETE while the
  render was still active returned `409`.
- `bun run --cwd packages/studio-server test` — new helper and directory-route suites pass. The
  six pre-existing symlink-retarget failures in that package reproduce on `main` unchanged and are
  unrelated to this diff.
- `bun run --cwd packages/studio test src/components/renders` — render panel and queue tests pass.
- `bun run --cwd packages/cli test src/server/studioServer.test.ts` — adapter test passes.
- `bun run --cwd packages/core test`, `packages/engine`, `packages/producer` — full suites pass
  (see the second commit, which repairs three macOS/ffmpeg-version test assumptions found while
  validating this branch).
- `bunx oxlint`, `bunx oxfmt --check`, package typechecks and
  `bunx fallow audit --base origin/main --fail-on-issues` are clean.

## Before

The render panel on `main`: the format selector offers MP4, MOV (ProRes) and WebM only, and every
queue row resolves to a single file.

![Before: the render panel's format selector on main, offering only MP4, MOV (ProRes) and WebM](./captures/issue-5553/before-format-dropdown.png)

## After

The same panel with **PNG sequence** available and selected. The quality selector disappears, since
PNG is lossless and fixed-quality like MOV.

![After: the format selector with PNG sequence added and selected](./captures/issue-5553/after-png-selected.png)

And a finished PNG-sequence render in the queue: a PNG badge and a frame count instead of a video
thumbnail, with the download control reading "Download as ZIP".

![After: the render history row for a finished PNG-sequence render, showing a PNG badge and 2 frames](./captures/issue-5553/after-render-row.png)

## Notes for review

- The ZIP64 path is covered by arithmetic tests for sizes and offsets past 4 GiB; no real >4 GiB
  archive is generated in the suite.
- Deleting a render that is still in flight returns 409 and logs nothing; the UI needs a retry for
  that case, which is a follow-up rather than part of this change.
- The cancel cleanup is shared by both adapter hosts but only the CLI host has an adapter-level
  cancel test today.
- The browser round trip has no automated suite. It was verified by hand against a real Studio
  server (see Testing), so a reviewer mainly needs to confirm the panel reads well.
