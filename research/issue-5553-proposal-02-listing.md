# Proposal 2 — Listing-shape for PNG-sequence in `GET /projects/:id/renders`

## Solution Proposals

**Context:**

- Request: "how `GET /projects/:id/renders` reports it (frame count, total size)." Today the route filters `*.mp4|*.webm|*.mov`, reads `statSync(fp).size`, and returns `id`, `filename`, `size`, `createdAt`, `status` (`packages/studio-server/src/routes/render.ts:325-369`). Directory outputs are not in the filter set, so they are invisible to the Studio UI today.
- Research Source: `research/issue-5553-png-sequence-route-state.md` — see "Listing", "Cross-component data flow step 5", and "Touchpoints" rows for `render.ts`, `walkDir`, and the CLI's existing directory-budget pattern at `packages/cli/src/commands/render.ts:1892-1902`.

### Proposal 1 — Discriminated rendering entry with directory-aware fields

- **Overview:** Add `"kind": "file" | "directory"` to the response shape and a directory payload alongside the existing fields. For directory outputs, surface `frameCount` (count of `*.png`), `sizeBytes` (sum of contained file sizes — same heuristic the CLI already uses at `packages/cli/src/commands/render.ts:1892-1902`), and `audioSidecar: boolean` (whether `audio.m4a` is present alongside the frames, the constant lives at `packages/engine/src/services/audioMixer.ts:64` and is what the producer writes in `encodeStage.ts:303-307`). The existing file-shaped entries stay byte-compatible; the new union member is additive.
- **Key Changes:**
  - `packages/studio-server/src/routes/render.ts:325-369` — replace the extension filter `*.mp4|*.webm|*.mov` with a `walkDir`-aware discovery: still call `readdirSync(rendersDir)` for backward-compatibility with Hono / dev watch tooling (already imported at line 3), but additionally probe each top-level entry with `statSync(...).isDirectory()` and, when true, run a contained-size option:
    - `frameCount = readdirSync(dir).filter(name => /^frame_\d{6}\.png$/.test(name)).length` (consumer-readable convention: `packages/producer/src/utils/paths.ts:119-121`).
    - `sizeBytes = sum(statSync(join(dir, name)).size for name in readdirSync(dir))`.
    - `audioSidecar = existsSync(join(dir, "audio.m4a"))`.
  - The output type widens from `{ id, filename, size, ... }` to a discriminated union keyed on `kind`. `packages/studio-server/src/index.ts:34-43` already exports `RenderJobState` externally; the broader change is internal to the routes module — no new public export needed.
  - `packages/studio-server/src/helpers/safePath.ts:81-110` — `walkDir` already exists and already skips `.thumbnails`, `.transcode-cache`, `.waveform-cache`, `node_modules`, `.git`, `.hyperframes/backup`. Listing-time discovery can re-use it for sub-directories under `renders/`, but a directory-shaped render has to surface as an entry of its own — i.e. discovery cannot flatten into the existing file-only filter; the route code needs a separate branch.
- **Trade-offs:**
  - **Pros.** UI gets the right facts to render a frame-count badge and a summed size column. The CLI's existing precedent at `packages/cli/src/commands/render.ts:1892-1902` already implements the sum-of-contained-bytes approach (the comment at line 1894 calls it out explicitly). MIME knowledge stays narrow: `Content-Type` is only set by `view|download|file/*` (`render.ts:241, 263, 314, 318`) — those endpoints are wired in proposal 03.
  - **Cons.** A listing call now does O(N) directory reads per render (one subdirectory per PNG-sequence render). For a project with hundreds of renders, the route's response-time grows linearly. The directory I/O is synchronous (`readdirSync` + `statSync` — `packages/studio-server/src/routes/render.ts:3, 331, 338`); a long renders dir blows the request budget.
- **Validation:**
  - New: a `render.listing.png-sequence.test.ts` posting a PNG-sequence render and asserting the listing returns one entry per directory, with `frameCount === N`, `sizeBytes === sum(N frame sizes)`, `audioSidecar === hasAudio`.
  - Regression: `render.test.ts` lines 47-65 (stale sidecar status) still passes — the file-shaped branch is unchanged.
  - Property: synthetically grow a `renders/<jobId>/` directory with 10,000 `frame_NNNNNN.png` files and assert listing latency stays under a documented budget (e.g. 200 ms on the CI runner) — this is what surfaces the synchronous-IO problem discussed above.
- **Open Questions:**
  - Does Studio need a separate listing page for directories (e.g. expanded "frames: 240" with click-to-view breakdown), or is the single-row badge enough? UI flow not in this issue's scope.
  - The CLI's `formatRenderSummaryDetail` (`packages/cli/src/ui/format.ts:21-25`) already shows "frame count for png-sequence directory output instead of a video length" for the CLI summary; can Studio's UI pipeline reuse the same function? If yes, this listing endpoint becomes a thin wire-format shim.

### Proposal 2 — Lazy: derive the directory payload on first GET, cache in the in-memory job map

- **Overview:** Don't recompute the directory stats on every listing call. After a render completes (the adapter's `state.status === "complete"` path — `packages/studio/vite.adapter.ts:374-384` writes `.meta.json`), the producer already has the exact frame count in `job.duration / fps` and the producer's `artifactTransaction.validate()` already confirms `expectedFrames` (`packages/producer/src/services/render/artifactTransaction.ts:308-318`). Persist `{ frameCount, sizeBytes, audioSidecar }` into the sidecar `.meta.json` and read it back at listing time — no inline directory walk.
- **Key Changes:**
  - `packages/studio/vite.adapter.ts:376-384` and `packages/cli/src/server/studioServer.ts:653-661` — extend the `.meta.json` write to include `frameCount: number | undefined` and `frameBytes: number | undefined` for PNG-sequence renders. The producer currently emits these only via `perfExtractBreakdown` (`packages/producer/src/services/renderOrchestrator.ts:5076-5085`) and not through the meta sidecar; either lift them, or compute in the adapter by `readdirSync(<jobId>)` immediately after commit.
  - `packages/studio-server/src/routes/render.ts:325-369` — read `frameCount` and `frameBytes` from `<rid>.meta.json` for directory entries; fall back to "`readdirSync(...).length` for files" if missing (a render whose metadata predates this change still renders correct `frameCount`).
  - The `resolveRenderArtifacts` whitelist (`render.ts:26-35`) is unchanged for the listing endpoint — the listing reads, not deletes.
- **Trade-offs:**
  - **Pros.** Listing stays O(1) per entry at response time. The on-disk sidecar becomes the source of truth, so a future cross-host render can be read by any consumer (matches what the producer's meta JSON already does elsewhere). Backward compat: a missed sidecar falls back to a one-time walk.
  - **Cons.** A render that completes but never writes the extra keys means the route reads an empty-bytes entry. The CLI already uses `meta.status` and `meta.durationMs` (`packages/studio-server/src/routes/render.ts:344-356`); adding `frameCount` and `frameBytes` is a sidecar schema change that has to be reflected anywhere that reads sidecars (search: `meta.status` — at minimum `render.ts:341`, `render.test.ts:50-60`).
- **Validation:**
  - New: assert the meta sidecar contains `frameCount` and `frameBytes` for `{ format: "png-sequence" }` renders and is unchanged for `mp4` renders.
  - Regression: existing render-listing tests (`render.test.ts:47-65`) still pass because the sidecar schema is additive — they read `meta.status` and ignore new keys.
  - Sidebar: a hand-crafted `<jobId>.meta.json` with an out-of-range `frameCount` returns a sane listing (does not crash, does not trust the sidecar's `frameCount` over a directory walk present alongside).
- **Open Questions:**
  - Where does the meta write happen — in the adapter (already touches the meta path at `vite.adapter.ts:376-384`) or in the producer (has the right numbers at line `5076-5085`)? The adapter is shorter to change and lives in the same package as the route, but the producer is the source of truth. The PR can land either path; the question is whether the meta sidecar is a "Studio-only" or "all-renders" contract — the cross-host preceder suggests the latter.
  - Caching invalidation: a directory whose `.meta.json` says 240 frames but which now has 245 on disk (post-render retry wrote more) is read as 240 by listing. Acceptable until a periodic walk runs, or do we recompute on `createdAt`-based staleness?
