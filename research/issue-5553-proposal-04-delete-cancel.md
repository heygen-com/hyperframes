# Proposal 4 — Delete + cancel for directory-shaped renders

## Solution Proposals

**Context:**

- Request: "Delete and cancel: remove the whole directory safely. Reuse `resolveWithinProject` / `isPrivateProjectFile` in `helpers/safePath.ts` so a crafted job id can't escape the project." Today DELETE accepts a single jobId, rejects `/`, `\`, `\0` (`packages/studio-server/src/routes/render.ts:284-286`), and `unlinkSync`'s each extension in `RENDER_ARTIFACT_EXTENSIONS` (`render.ts:26-35, 281-296`). The jobId restricted to those characters but the safety helpers go further: `resolveWithinProject` (`packages/studio-server/src/helpers/safePath.ts:24-29`) re-canonicalizes via realpath so a symlink inside `renders/` cannot escape the project root.
- Research Source: `research/issue-5553-png-sequence-route-state.md` — see "Delete", "Cross-component data flow step 7", "Test gaps relative to the issue's 'Done when'", and the existing `renderDeletion.test.ts` cases at lines 56-134.

### Proposal 1 — `rmSync` the validated directory, mirror `resolveWithinProject` semantics

- **Overview:** Treat a directory-shaped delete as one `rmSync(<validated path>, { recursive: true, force: true })` after the same jobId safety check the file path already has. Reuse `resolveWithinProject` for the directory path so symlinks-into-`renders/` that retarget at delete time still can't escape. Cleanup remains transactional from the issuer's perspective: the directory either disappears or doesn't, no half-empty state. Cancel follows the same model in the adapter, with the existing producer `ExecutionContext`-managed rollback (`packages/producer/src/services/renderOrchestrator.ts:2931`) doing the abort-time work.
- **Key Changes:**
  - `packages/studio-server/src/routes/render.ts:281-296` — after the existing `jobId.includes` check (line 284), branch on directory-or-file:
    - If `lstatSync(<resolved path>).isDirectory()` (using `lstatSync`, not `statSync`, so symlinked dirs return as a symlink, not a directory that's followed), `rmSync(<resolved path>, { recursive: true, force: true })`.
    - Else, keep the existing artifact-by-artifact unlink loop.
  - The validation path in `render.ts:287-289` becomes:
    - `resolveRenderArtifacts(directories, jobId)` for the file branch (must remain non-null per line 289).
    - `resolveWithinProject(directories[0], jobId)` for the directory branch, then `!isPrivateProjectFile(project.dir, resolved)` to mirror the file branch's reject (`safePath.ts:36-67`).
  - `packages/studio/vite.adapter.ts:322-336` — `removeCancelledOutput` widens from "unlink outputPath and outputPath+.meta.json" to "rmSync outputPath if it's a directory, unlink canonical outputPath + .meta.json if it's a file".
  - `packages/cli/src/server/studioServer.ts:596-610` — same broadening (CLI keeps its own copy).
  - The route's `isPlainFile` (`render.ts:220-226`) stays — the view / download endpoints continue to gate on a regular file, so a directory render returns 404 from `view` / `download` and `200 { deleted: true }` from DELETE (not the same code path; see Open Questions).
- **Trade-offs:**
  - **Pros.** Single source of truth for cleanup: `rmSync` an artefact-shaped entity once. The codebase already uses `rmSync(..., { recursive: true, force: true })` in `ArtifactTransaction.rollback` (`packages/producer/src/services/render/artifactTransaction.ts:404-415, 434-441`) — same idiom, consistent. The existing `isPlainFile` / `statSync(..., { throwIfNoEntry: false })` usage in `render.ts:312` and `render.ts:351` (which both use `existsSync` first) means the route already knows how to detect the no-entry case without throwing.
  - **Cons.** `rmSync` cannot distinguish "I just deleted zero files" from "I deleted millions of files" without a separate listing — the route has to return a true / false that doesn't depend on counting. Also, the route's existing `resolveRenderArtifacts` returns an array of paths; this branch replaces part of it. Tests need to be re-walked: `renderDeletion.test.ts:56-134` exercises file-shaped deletes only.
  - **Cons.** A directory whose sub-path is a directory requires recursion-safe semantics. `walkDir`'s `IGNORE_DIRS` filter (`packages/studio-server/src/helpers/safePath.ts:81-95`) is for listing projects; it is not invoked on delete and must not be — a directory render must delete its entire contents, including any temporary files that landed inside it during capture.
- **Validation:**
  - New: `renderDeletion.test.ts` analogues, scoped to directories:
    - "deletes a directory render and any emitted sidecar" — write a directory with a 240-frame mock, mkdir a sibling `.meta.json`, call DELETE, assert `existsSync(<dir>) === false`.
    - "rejects `..` in a job id even when it's framed as a directory" — paths-traversal test (mirror of `renderDeletion.test.ts:103-112`).
    - "rejects escaping artifact symlinks before deleting anything" — directory is a symlink to `outside/`; DELETE returns 403 and `outside/` is preserved (mirror of `renderDeletion.test.ts:114-134`).
  - The existing "returns success without recreating a missing render directory" (`renderDeletion.test.ts:96-101`) is unchanged and serves both file and directory shapes once `dirs[0]` here is interpreted as a _project_ dir, not a render dir, so test passes for both.
  - Cancel: a `studio / cli studioServer` adapter test that pre-stages a directory render, signals the abort controller, asserts `rmSync` was called and the directory is gone.
- **Open Questions:**
  - Should the directory branch be gated on "is this format a directory type?" (knowable from the in-memory job map — `state.outputPath`) or on `lstatSync(<resolved>).isDirectory()` (defensible against a hand-crafted directory someone dropped into `renders/`)? The first is principled (only delete what we created) but breaks if someone manually archived into `renders/`; the second is robust but requires the validation step before `rmSync`.
  - The route currently `renderJobs.delete(jobId)` (line 294) at the end of DELETE. After a directory delete, the in-memory entry should be gone too — same line, no change. But the SSE stream (`/render/:jobId/progress`) is keyed on `renderJobs.get(jobId)` (line 187) — once deleted, the in-progress stream 404s mid-stream. Document that, or let the stream silently close; the cancel branch already terminates the stream with the same `status: "cancelled"` payload (`render.ts:209-218`, adapter sets it before removeCancelledOutput runs).
  - Race: a render that is still writing frames when DELETE arrives may delete a half-written directory. The producer's `ExecutionContext.defer("rollback staged artifact", …)` (`packages/producer/src/services/renderOrchestrator.ts:2931`) only rolls back the staging path, not the committed `outputPath`. Add an adapter-level guard that refuses DELETEs while `state.status === "rendering"`.

### Proposal 2 — Walk the directory and unlink each entry individually

- **Overview:** Mirror the existing file-loop pattern (`render.ts:291-293`): after the same jobId validation, enumerate `readdirSync(<validated dir>)` and `unlinkSync` each contained file. Avoids `rmSync`'s O(1) "all-or-nothing" semantic; preserves any sidecar files the route knows about and skips the rest.
- **Key Changes:**
  - `packages/studio-server/src/routes/render.ts:281-296` — branch (same gate as proposal 1) and:
    - `for (const entry of readdirSync(resolved))`, check the entry name against an allowlist (`/^frame_\d{6}\.png$/`, equal to `audio.m4a`).
    - `unlinkSync(join(resolved, entry))` for each allowed entry.
    - After the loop, `rmSync(resolved)` on the now-empty directory.
  - The frame-name allowlist is the same regex the **listing** branch must use (proposal 02), aligning delete with discovery. The audio-sidecar filename matches `MIXED_AUDIO_FILENAME` from `packages/engine/src/services/audioMixer.ts:64`.
  - Adapters in `packages/studio/vite.adapter.ts:322-336` and `packages/cli/src/server/studioServer.ts:596-610` — same widening: from "unlink the file and its meta" to "rmSync the directory if it's a directory, else unlink as before".
- **Trade-offs:**
  - **Pros.** Each unlink is a logged event, easier to debug a partial-failure ("couldn't delete `frame_000123.png`, leaving the directory"). The "delete only what we recognise" filter is a defence-in-depth against any stray file dropped into the directory post-commit.
  - **Cons.** A large render (e.g. 5,000 frames) reads and writes 5,000 file entries instead of one. Statistically slower; on rotational disks this matters. Operator runtime is harder to reason about — `unlinkSync` per file means 5,000 separate fs syscalls on cold-cache disks. Also: the producer's `ArtifactTransaction.rollback` (`packages/producer/src/services/render/artifactTransaction.ts:404-415`) already uses `rmSync(..., { recursive: true, force: true })` — divergent from the route's delete path. Two different delete idioms in the same package is a future-bug risk.
  - **Cons.** Reads vs writes: if the directory contains a frame whose disk-block is failing, `unlinkSync` reports `ENOENT` or `EBUSY` whereas `rmSync` aggregates. Per-frame error handling surfaces more noisy partial-failure modes.
- **Validation:**
  - New: `renderDeletion.test.ts` directory cases:
    - "deletes a directory render, frame-by-frame" — assert each `frame_NNNNNN.png` becomes unavailable in turn.
    - "skips and reports an unrecognised entry" — drop `not-a-frame.txt` into the directory, expect DELETE to leave it untouched (or to log a warning and skip). Confirms the allowlist is intentional.
    - "deletes `audio.m4a` alongside frames when present" — seed `audio.m4a`, DELETE, assert gone.
  - The `renderDeletion.test.ts:114-134` symlink test still passes with this approach because `lstatSync` per-entry reveals the symlink and rejects before unlink.
  - The `renderDeletion.test.ts:103-112` "nested/keep" test maps naturally: a directory whose basename contains `/` would be rejected at line 284's check, then if a user-crafted nested directory somehow exists, this proposal's `readdirSync` won't recurse into it.
- **Open Questions:**
  - What does DELETE return for a directory with an unrecognised entry? `{ deleted: true }` (best-effort, the URL was structurally valid) or a 207 Multi-Status? The route today returns 200 either way, so best-effort matches the existing precedent; that's also how `ArtifactTransaction.rollback` reports.
  - Does the Studio UI surface the frame-by-frame progress of a delete (N out of M frames removed)? Not currently — the route is one-shot. Proposal 1 is simpler from the UI side.
  - Path-safety at the entry level: the allowlist `/^frame_\d{6}\.png$/.test(entry)` is robust (digits only), but `audio.m4a` is a fixed string. Anything else? If the producer ever decides to also write something else (`manifest.json` for indexing?), the route's allowlist has to grow. Suggest the producer lock the contents of `<jobId>/` to exactly the two known filenames.
