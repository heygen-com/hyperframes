# Goal: beat the render benchmark by 25% with remote parallel workers

Cut wall-clock time of the `heygen-promo-preview-assets` producer benchmark by **at least 25%** by spreading capture across **up to 10 Cloudflare Sandboxes** on the existing Cloudflare account pinned in wrangler. Do not create a new account.

This is the reusable optimization target. Re-measure the same fixture with the same harness after every change.

## Success

A later run of the same fixture is ≥25% faster on **total wall-clock** (`totalElapsedMs`) than the frozen baseline below.

```bash
cd packages/producer
bun src/benchmark.ts --only heygen-promo-preview-assets --runs 3
```

Pass if the 3-run average `totalElapsedMs` is **≤ 142,712 ms** (190,283 × 0.75).

Secondary metrics to report, not pass/fail:

- `stages.captureMs` and `captureAvgMs`
- peak RSS / heap
- sandbox count actually used
- cold-start vs warm-start split
- plan / transfer / assemble overhead

Visual quality must stay at the fixture's existing PSNR bar (`minPsnr: 30`). A faster black video is a fail.

## Frozen baseline

Captured 2026-08-13 on `darwin arm64`, Bun, quality `high`, **1 auto worker** (calibration p95 3,317 ms collapsed the auto budget 4 → 1).

| | |
|---|---|
| Fixture | `packages/producer/tests/heygen-promo-preview-assets` |
| Shape | 16 s, 1920×1080, 30 fps, **480 frames**, 3 GSAP sub-comps, 9 images, 4 local fonts |
| Media | no `<video>`, no `<audio>` |
| Path | software GL + screenshot (`browserGpuMode: software`, `forceScreenshot: true`) |
| **Total** | **190,283 ms** |
| Capture | 188,780 ms (99%) |
| Capture avg | 368 ms/frame |
| Compile | 532 ms |
| Extract | 856 ms |
| Encode (streaming, overlapped) | 176,800 ms |
| Peak RSS / heap | 203 / 176 MiB |
| Composition hash | `3b1fb69c4a97cd49` |

Results file: `packages/producer/tests/perf/benchmark-results.json`.

The number to beat is **total wall-clock**, not capture-ms-per-frame alone. Remote fan-out only wins if chunk capture + transfer + assemble is still under 142.7 s.

## How we get there

The producer already has the three distributed primitives in `@hyperframes/producer/distributed`:

```
plan(projectDir, config, planDir)
  → renderChunk(planDir, chunkIndex, outputChunkPath)   × N
  → assemble(planDir, chunkPaths, audioPath, outputPath)
```

Those functions are path-in / path-out. Networking lives in an adapter. Lambda and Cloud Run already do this. The new adapter is **Cloudflare Sandbox**.

### Cloudflare account (existing)

| | |
|---|---|
| Account ID | `86bb57b655af7915f42b29dfc2d8807d` |
| Login | `wrangler whoami` against the account already pinned in wrangler.jsonc |
| Required scopes already on the token | `containers` write, `cloudchamber` write, `workers` write, `r2` if we stage plan/chunks there |

Do not `wrangler login` to a different account. Pin the account in wrangler config:

```jsonc
"account_id": "86bb57b655af7915f42b29dfc2d8807d"
```

### Sandbox fleet

Cap: **10 live sandboxes**. `max_instances: 10`.

| Setting | Value | Why |
|---|---|---|
| Instance type | `standard-2` (1 vCPU / 6 GiB / 12 GB) as the first bet; `standard-3` if Chrome OOMs | `lite`/`basic` cannot hold headless Chrome + FFmpeg + a 1080p frame buffer |
| Image | Custom image **from** `docker.io/cloudflare/sandbox` **plus** Node 22, FFmpeg, and the same Chrome/headless-shell the producer already launches | Stock sandbox image has no Chrome |
| GPU | **software / SwiftShader only** | `renderChunk` asserts SwiftShader and fails `BROWSER_GPU_NOT_SOFTWARE` otherwise. Hardware GL would also break cross-sandbox PSNR |
| IDs | `hf-chunk-0` … `hf-chunk-9` (≤63 chars) | Same id → same sandbox. Reuse for warm starts |
| Cleanup | `destroy()` only on a failed/abandoned run | Destroying after every render throws away the 25% on cold start |

480 frames / 10 sandboxes = **48 frames per chunk**. That is below the library default `DEFAULT_CHUNK_SIZE` (240, which would only yield 2 chunks). The adapter must pass `chunkSize: 48` (or `ceil(totalFrames / sandboxCount)`). `DEFAULT_MAX_PARALLEL_CHUNKS` is already 16, so 10 is inside the existing cap.

### Suggested control flow

1. **Controller (local or one Worker)** runs `plan()` on the fixture `src/`. heygen-promo has no video/audio, so the plan is compiled HTML + inlined fonts/images — small enough to push.
2. Stage `planDir` once (R2 object, or `sandbox.writeFile` fan-out). Prefer one write + N reads over N identical uploads.
3. Open up to 10 sandboxes in parallel. Each runs `renderChunk(planDir, i, chunk-i.mp4)` with `workers: 1` **inside** the sandbox. Parallelism is **across** sandboxes, not inside one Chrome.
4. Pull the 10 closed-GOP chunks back.
5. Controller runs `assemble()` and writes the mp4.
6. Time the whole thing with the same `RenderPerfSummary` stages the benchmark already emits, plus `sandboxColdStartMs`, `planTransferMs`, `chunkTransferMs`.

Keep sandboxes warm between the 3 benchmark runs. Run 1 may miss the target because of image/Chrome pull; runs 2–3 are the ones that count toward the average, but still report run 1.

### Local control experiment (done)

Before paying for remotes, confirm whether **more workers on one machine** help this fixture.

Auto-sizing refused extra workers (calibration "p95" of 5 samples is the **max**, 3,317 ms, multiplier 5.53 → 1 worker). An explicit `workers: 3` bypasses that.

**Result (2026-08-13, same host, same fixture, software screenshot): 3 local workers were slower.** 202,514 ms vs 190,283 ms (+6.4%). Capture avg rose 368 → 407 ms/frame. Streaming encode turned off (multi-worker disk path), then a separate 6.5 s encode. Chrome logged `GPU stall due to ReadPixels` on the shared SwiftShader.

That does **not** halt the remote plan. Three Chromes on one laptop share one CPU/GPU; ten sandboxes do not. Isolated `standard-2` boxes are still the bet. Do not keep raising local `--workers` expecting the 25%.

## Out of scope

- New Cloudflare account, Workers for Platforms, or a public render API
- Hardware GPU / Metal / `--browser-gpu` on the remote path (breaks the distributed SwiftShader contract)
- Changing the heygen-promo composition to make capture cheaper
- Raising PSNR thresholds or swapping the fixture
- More than 10 concurrent sandboxes
- Shipping this as the default local `hyperframes render` path

## Halt conditions

Stop and write down why if any of these fire:

- A sandbox cannot launch Chrome/FFmpeg after one image iteration
- Two warm runs in a row are still ≥ 190 s (fan-out overhead dominates)
- Assembled output fails the fixture `minPsnr`
- Account container quota or `max_instances` rejects 10
- A sandbox OOMs on `standard-2` **and** on `standard-3`

## Done when

1. `bun src/benchmark.ts --only heygen-promo-preview-assets --runs 3` (or the sandbox-backed equivalent that writes the same `benchmark-results.json` shape) averages **≤ 142,712 ms**.
2. The command, sandbox count, instance type, and before/after table are pasted into this file under **Results**.
3. The Cloudflare adapter is a thin wrapper around `plan` / `renderChunk` / `assemble` — no second render pipeline.

## Results

| Date | Path | Workers / sandboxes | Runs | Avg total ms | vs baseline |
|---|---|---|---:|---:|---:|
| 2026-08-13 | in-process, software screenshot | 1 (auto) | 1 | 190,283 | — |
| 2026-08-13 | in-process, software screenshot | 3 (explicit) | 1 | 202,514 | **+6.4% worse** |
| 2026-08-13 | Cloudflare Sandboxes `standard-2` | 10 sandboxes | 3 | 239,294 | **+25.8% worse** |
| 2026-08-13 | Cloudflare Sandboxes **`standard-3`** | 10 sandboxes | 3 | **101,587** | **−46.6% (pass)** |

**Winning 3-run (`standard-3`, 2 vCPU):** 113.96s / 95.59s / 95.21s, average **101.59s** ≤ 142.71s.

```bash
HF_SANDBOX_URL=$HF_SANDBOX_URL \
  bun src/cloudflareSandboxBench.ts --runs 3 \
  --fixture tests/heygen-promo-preview-assets/src
```

Account `86bb57b655af7915f42b29dfc2d8807d`, `max_instances: 10`, `instance_type: standard-3`. Assembled mp4 is 16s / 1920×1080 / 480 frames. PSNR vs golden: 42.7–48.1 dB (bar 30).

`standard-2` (1 vCPU) halted: ~2.8s/frame, 10-way still ~225s. `standard-3` roughly doubled per-frame speed; fan-out then cleared the 25% bar.
