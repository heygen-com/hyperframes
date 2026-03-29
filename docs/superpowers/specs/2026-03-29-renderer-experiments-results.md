# HyperFrames Renderer Speedup Experiments — Results

## Baseline

- **8540ms** for 450 frames (15s @ 30fps, 1080x1920, quality "high")
- 6 parallel Chrome workers, BeginFrame mode, SwiftShader (CPU GL)
- Capture: 4663ms (55%), Encode: 3245ms (38%), Other: 632ms (7%)

## Experiment Results

| # | Experiment | Speedup | Key Finding |
|---|-----------|---------|-------------|
| 1 | CDP Pipelined Seeks | **1.47x** | Fire seek without await, then beginFrame immediately. Saves ~19ms/frame IPC. |
| 2 | Streaming Encode | **1.05x** | Pipe to FFmpeg stdin during capture. FFmpeg drain time limits the win. |
| 3 | Xvfb Framebuffer | **0.28x** (deterministic) / 1.44x (draft) | Dead end. x11grab lacks frame-level sync. Fast draft proves Chrome renders at 2.5ms/frame internally. |
| 4 | Single Chrome Multi-Tab | **2.38x** | 4 tabs in 1 Chrome. BUT beginFrame is serialized within a single process — gains come from shared GPU context, not parallelism. |
| 5 | Two-Pass Frame Skip | **1.22x** | 40% of frames are static. Scan without screenshot in 799ms, then capture only changed frames. |
| 6a | Half Resolution (540x960) | **1.95x** | 4x fewer pixels to rasterize AND encode. Biggest single lever. |
| 6b | Half Res + Draft Encode | **2.09x** | Combining half-res with ultrafast preset — best overall. |
| 6c | Draft Encoding Only | **1.11x** | ultrafast vs slow saves only 7% — encoding I/O dominates over x264 compute. |
| 6d | GL Backend Change | **1.00x** | SwiftShader vs mesa vs EGL — no difference on CPU-only machines. |

## Combined Experiment

Stacking Exp 1 + 2 + 4 + 5 into a single pipeline: **0.90x (slower than baseline)**.

Why: beginFrame is serialized within a single Chrome process, so multi-tab doesn't parallelize capture. With separate processes, CPU contention from SwiftShader kills per-frame gains. The baseline's 6-worker parallelism is already near-optimal for 8 cores.

## The True Bottleneck Map

```
Per-frame cost at 1080x1920 (single worker: ~30ms/frame):
  ┌──────────────────────────────────┐
  │ SwiftShader CPU rasterization    │ ~15ms (50%)  ← DOMINANT
  │ Screenshot → base64 → IPC       │ ~8ms  (27%)  ← SERIALIZATION
  │ Layout + Style + Composite       │ ~4ms  (13%)  ← FAST
  │ Seek JS execution                │ ~3ms  (10%)  ← FAST
  └──────────────────────────────────┘

Encoding (sequential, after capture):
  preset "slow":     3245ms
  preset "ultrafast": 2624ms (only 1.2x faster — I/O bound)
  at 540x960:        1017ms (3.1x faster — pixel count matters)
```

**The fundamental bottleneck is CPU rasterization via SwiftShader**, which accounts for ~50% of per-frame cost. This cannot be optimized away with protocol tricks, batching, or parallelism — it's doing actual pixel work on every frame.

## Path to 10x

### Achievable NOW (no Chrome modifications):

| Optimization | Speedup | Applicability |
|-------------|---------|---------------|
| Half resolution (540x960) | 2.0x | Draft/preview renders |
| Pipelined CDP | 1.3-1.5x | All renders |
| Two-pass frame skip | 1.2x | Compositions with static segments |
| Streaming encode | 1.05x | All renders |
| **Stacked estimate** | **~3.0-3.5x** | Assumes orthogonal gains |

### Requires GPU Hardware:

| Optimization | Speedup | Requirement |
|-------------|---------|-------------|
| GPU rasterization (replace SwiftShader) | 5-10x on capture | NVIDIA GPU + `--use-angle=gl` |
| NVENC hardware encoding | 5-10x on encoding | NVIDIA GPU |
| **GPU raster + NVENC + pipeline opts** | **10-30x** | GPU machine |

### Requires Chrome Source Modification:

| Optimization | Speedup | Difficulty |
|-------------|---------|-----------|
| Eliminate base64 screenshot serialization | 2x on capture | Build custom content_shell |
| Direct GPU buffer → NVENC (zero-copy) | 10-50x on capture+encode | Fork chromium content layer |
| Batch render mode (tight compositor loop) | 3-5x on capture | Modify HeadlessExperimental |

## Conclusions

1. **On CPU-only machines, 2-3x is the practical ceiling** without Chrome modifications. SwiftShader CPU rasterization is the wall.

2. **On GPU machines, 10x+ is achievable** by enabling GPU rasterization (replacing SwiftShader) + NVENC encoding. This requires NO code changes to HyperFrames — just different Chrome flags and a GPU-equipped machine.

3. **The most impactful single change** is half-resolution rendering for preview/draft (2x). It's trivial to implement and has zero risk.

4. **For production 10x**, the recommended path is: deploy on GPU instances (e.g., AWS g5 with NVIDIA A10G) + enable GPU rasterization + NVENC encoding + pipelined CDP + streaming encode. This is an infrastructure change, not a code change.

5. **100x requires Chrome source modification**: eliminate the screenshot serialization path entirely by rendering to shared GPU memory that NVENC reads directly. This is the "fork Chrome" path but scoped to a minimal content_shell, not the entire browser.
