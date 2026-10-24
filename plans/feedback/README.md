# Plan feedback

Use this folder to collect feedback on research and implementation plans without
editing the plan itself. The current PNG-sequence plan is
`plans/issue-5553-png-sequence-route.md`.

## Add feedback

1. Create a Markdown file in this folder, for example
   `2026-10-14-issue-5553-png-sequence-route.md`.
2. Copy the feedback exactly as received under **Feedback (verbatim)**. Keep
   separate reviewers' feedback in separate files.
3. Fill in the source and date if known. Add your own clarifications under
   **Notes**, not inside the verbatim text.

Use this template:

```md
# Feedback on: plans/issue-5553-png-sequence-route.md

- Received: Yes
- From/source: Rames, jrusso1020

## Feedback (verbatim)

Paste the feedback here exactly as received.

Thanks for writing the questions down before the code. That's what #5553 asked for. Here are my answers, checked against main @ 9b996059. This is a COMMENT, since there's no code to approve yet.
Short version: Q1 A, Q2 A with a fallback, Q3 on-demand archive (see the format note), Q4 A, Q5 A. Two things in the adapters will break with a directory output whatever you choose, so please put them in the implementation plan (first section below).
Two things that break with a directory output

1.  The metadata file path comes from the file extension. Both adapters build it with opts.outputPath.replace(/\.(mp4|webm|mov)$/, ".meta.json"): studio/vite.adapter.ts:328,380,397 and cli/src/server/studioServer.ts:602,657,684. A png-sequence outputPath has no extension, so the replace does nothing and metaPath === outputPath.
    o On success, writeFileSync targets the frames directory and throws EISDIR after the render has already published.
    o On failure, {status:"failed"} is written to the place the directory would have gone.
    o Fix: derive the sidecar from the job id (join(rendersDir, \${jobId}.meta.json`)`), not from the output path.
2.  Cancel cleanup does not "already handle" directories. removeCancelledOutput calls unlinkSync on outputPath, and the error is swallowed. unlinkSync on a directory fails, so a cancelled png-sequence render leaves its frames behind. That breaks #5553's "cancelling it leaves nothing behind".
    o It needs an lstat().isDirectory() branch that uses rmSync(path, { recursive: true, force: true }).
    o Add a test that cancels a directory render after commit.
    Related: the producer stages into a hidden sibling, .<jobId>.hf-transaction-XXXXXX/, created inside renders/ (artifactTransaction.ts:140-148). Today the listing ignores it only because of the extension filter. When the listing starts accepting directories, skip dot-prefixed entries explicitly.
    Q1, on-disk shape: A, a directory named by the job id
    Agreed. The producer already publishes renders/<jobId>/ atomically (ArtifactTransaction with kind: "directory", renderOrchestrator.ts:2882-2885), and the CLI writes the same shape.
    • Branch on "is a directory output", not on format === "png-sequence". hls is also a directory output (renderOrchestrator.ts:2882-2885 passes isPngSequence || isHls). If the route's directory branch keys on the artifact kind, HLS doesn't need a second widening later.
    Q2, listing: A, with a fallback for a missing sidecar
    • Write frameCount and the summed size into the sidecar when the render completes, and read them in the listing.
    • Keep the existing field name size, don't add a new sizeBytes, so current clients keep working. Add kind: "directory" to directory entries only.
    • Discover entries from the filesystem, not from the sidecar. A directory is a render entry when it isn't dot-prefixed, lstat says it's a real directory (not a symlink), and it resolves through resolveWithinProject.
    • If the sidecar is missing or has no frameCount (for example a directory copied in from the CLI), fall back to one readdirSync count plus a size sum. The CLI's readOutputFootprint (cli/src/commands/render.ts:1913-1930) is the helper to share, not the block at 1892-1906, which is telemetry.
    Q3, download: on demand, no zip written at completion
    Agreed on streaming per request. Some notes on the format:
    • Precedent: cloud rendering already packages png-sequence as a single archive. Cloud Run and Lambda tarDirectory(...) the frames to .tar.gz (gcp-cloud-run/src/server.ts:594-597, aws-lambda/src/s3Transport.ts, which uses the tar package). So a single-file archive is the existing pattern; the open question is zip vs tar.
    • If zip: use STORE, and it must support ZIP64. A 4K RGBA sequence passes 4 GB quickly (around 900 frames at 5-15 MB each). A writer without ZIP64 will produce a corrupt archive past that size, with no error.
    • Content-Length is possible. With STORE, every entry's size is known from stat before streaming, so the total length is deterministic. That gives browsers a progress bar, contrary to the "cons" list. CRC-32 can go in the data descriptor.
    • There is already a zip dependency. adm-zip is in packages/cli. It builds archives in memory, though, so it's the wrong tool for frames. Don't reuse it here.
    • audioMixer.ts doesn't use zlib.crc32/deflateRaw as the plan says. zlib.crc32 itself exists on Node ≥22.2, which is fine against engines: >=22.
    • My preference: a streamed STORE zip with ZIP64, since macOS and Windows open zip natively. A plain streamed .tar (no gzip, since PNGs are already compressed) is the simpler alternative and matches cloud output. Either is fine; just not a zip without ZIP64.
    • GET /render/:jobId/view has nothing to play for a directory. Return a 404 for directory jobs and hide the action in the UI.
    • If /projects/:id/renders/file/\* should serve individual frames (a first-frame thumbnail, say), add .png → image/png to RENDER_MIME. Today an unknown extension falls back to video/mp4.
    Q4, DELETE while rendering: A, 409
    Agreed, but the reason is different from the one in the plan.
    • The destination doesn't exist during a render, because staging lives in the hidden sibling. So a DELETE mid-render deletes nothing.
    • The render then commits, and the deleted job reappears in the listing. A 409 while status === "rendering" closes that, and it fixes the same gap the file formats already have.
    • For the directory delete itself:
    o Extend resolveRenderArtifacts with the bare ${jobId} candidate.
    o Keep the existing /, \ and NUL rejection.
    o lstat the resolved path and remove it recursively only when it's a real directory.
    o The traversal test #5553 asks for should include a symlink planted at renders/<jobId> pointing outside the project.
    Q5, sidecar schema: A, additive
    Agreed. The listing reader already ignores unknown keys. No version field for now.
    The two decisions "recorded at the end of the body"
    I can't find them. Both the PR body and plans/issue-5553-pr-body.md end at Q5. The only one I can infer is RenderJobState gaining kind?: "file" | "directory", which I agree with (set it in startRender from the format). Please add the second one, or point me to it.
    Smaller corrections to the doc
    • artifactTransaction.ts:2882-2886 should be renderOrchestrator.ts:2882-2885; artifactTransaction.ts is 450 lines long.
    • The current DELETE has no rendering check. The :238-259 lines cited as "the existing 404" are the view route.
    Not a run: I read the code on main and did not render a png-sequence through Studio.

## Notes

Optional context or questions. Leave blank if none.
```
