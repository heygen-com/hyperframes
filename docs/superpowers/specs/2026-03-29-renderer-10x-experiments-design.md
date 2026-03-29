# HyperFrames Renderer 10-100x Speedup Experiments

## Goal

Make the HyperFrames renderer 10-100x faster while maintaining identical output quality.
HTML/CSS/JS stays as the composition format. Only the engine/producer rendering pipeline changes.

## Current Architecture & Bottleneck Analysis

### Per-Frame Cost Breakdown (67ms avg on Linux/BeginFrame mode)

| Stage | Time | % of Total | Description |
|-------|------|-----------|-------------|
| CDP beginFrame call | ~50-55ms | 78% | IPC + layout + paint + composite + base64 encode + transport |
| Seek JS execution | ~5-10ms | 10% | `window.__hf.seek(time)` via `page.evaluate()` |
| Before-capture hook | ~2-5ms | 5% | Video frame injection |
| Disk write | ~5-20ms | 7% | `writeFileSync` (eliminated with streaming) |

**Key insight**: 78% of per-frame cost is the CDP screenshot round-trip. This is where 10x lives.

### What Happens Inside That 50-55ms CDP Call

1. Node.js serializes CDP message → sends over pipe to Chrome (~1ms)
2. Chrome dispatches to HeadlessExperimental handler (~1ms)
3. Chrome runs full compositor cycle: Style → Layout → Paint → Composite (~15-25ms)
4. Skia rasterizes via SwiftShader (CPU-based GL) (~10-15ms)
5. Screenshot pixels → JPEG/PNG encode (~5-10ms)
6. JPEG bytes → base64 string (~2-5ms)
7. Base64 string → CDP response over pipe back to Node.js (~2-5ms)
8. Node.js base64 decode → Buffer (~1-2ms)

### Total Pipeline for 30s/30fps Video (900 frames, 2 workers)

| Stage | Current Time |
|-------|-------------|
| Browser launch (2x) | ~4s |
| Page init (2x) | ~2s |
| Frame capture (450 frames/worker) | ~30s |
| FFmpeg encode | ~5s |
| Audio mix | ~1s |
| Faststart | ~0.5s |
| **Total** | **~42s** |

**Target: 4s (10x) or 0.4s (100x)**

## Experiments

### Experiment 1: CDP Batch Rendering

**Hypothesis**: Most of the 50ms per-frame CDP cost is IPC overhead and Chrome message dispatch latency, not actual rendering. Batching multiple frames into a single CDP evaluation should eliminate per-frame IPC.

**Approach**: Inject a JavaScript function into Chrome that runs the entire render loop:
```
1. From inside the page, loop through all frame times
2. Call window.__hf.seek(time) for each
3. Use requestAnimationFrame or direct compositor call
4. Capture via OffscreenCanvas or internal API
5. Stream frame data out via a single channel
```

**Variant A - CDP Screencast**: Use `Page.startScreencast` instead of per-frame `captureScreenshot`. This streams frames continuously at a configurable max resolution.

**Variant B - Evaluate + beginFrame batch**: Send a single `Runtime.evaluate` that pre-registers all seek times, then drive `beginFrame` in a tight loop from Node.js without waiting for full round-trip completion.

**Expected speedup**: 3-5x (eliminates IPC overhead per frame)

### Experiment 2: Raw Pixel Pipe (Kill Base64 Serialization)

**Hypothesis**: Base64 encoding/decoding adds ~7ms per frame and inflates data by 33%. Raw pixel transport via pipe or shared memory eliminates this entirely.

**Approach**:
1. Use CDP `IO.read` with `Page.captureScreenshot` returning a stream handle instead of inline data
2. Or: modify Chrome launch to use `--remote-debugging-pipe` (already used by Puppeteer) and intercept raw screenshot buffers before base64 encoding
3. Pipe raw JPEG/PNG bytes directly to FFmpeg stdin without intermediate base64 step
4. Combine with streaming encoder for zero-copy frame pipeline

**Variant**: Use `Page.captureScreenshot` with `encoding: "binary"` if supported by the CDP version.

**Expected speedup**: 1.5-2x (eliminates base64 overhead + enables zero-copy pipe to FFmpeg)

### Experiment 3: Xvfb Virtual Framebuffer Capture

**Hypothesis**: The entire CDP screenshot path is unnecessary. Chrome already renders to a framebuffer — capture it directly.

**Approach**:
1. Install Xvfb (virtual X11 framebuffer)
2. Launch Chrome in headed mode inside Xvfb (NOT headless)
3. Use `ffmpeg -f x11grab` to capture the virtual display directly
4. Drive animation via CDP `Runtime.evaluate` for seeking, but bypass CDP screenshot entirely
5. Use BeginFrame-style deterministic mode to control frame timing

**Challenge**: Determinism. x11grab captures at real-time rate. Need to synchronize frame capture with animation seeking.

**Variant**: Use `xdotool` or X11 events to synchronize, or accept near-deterministic output for draft renders.

**Expected speedup**: 5-10x (bypass entire screenshot serialization path)

### Experiment 4: Single-Process Multi-Tab Rendering

**Hypothesis**: Spawning N Chrome processes (current approach) wastes memory and CPU on duplicate browser overhead. A single Chrome process with N tabs sharing GPU context is more efficient.

**Approach**:
1. Launch single Chrome instance
2. Create N pages (tabs), each handling a frame range
3. Pages share the GPU context and SwiftShader instance
4. Round-robin or parallel beginFrame calls across pages
5. Single CDP session multiplexed across pages

**Expected speedup**: 2-3x for multi-worker scenarios (eliminates duplicate browser overhead, better CPU utilization)

### Experiment 5: Aggressive Frame Skipping

**Hypothesis**: Many compositions have static regions or frames where only transform/opacity changes. The existing `hasDamage` detection only catches fully static frames. We can be smarter.

**Approach**:
1. Pre-analyze the GSAP timeline to identify keyframe boundaries
2. Only render frames at animation transition points
3. For transform/opacity-only animations between keyframes, render start+end and let FFmpeg interpolate (minterpolate filter) or copy the nearest rendered frame
4. Use `hasDamage` more aggressively: if damage is only in a small region, composite the changed region onto the previous frame

**Expected speedup**: 2-10x depending on composition (more static content = bigger win)

## Benchmark Strategy

### Test Compositions
- `chat` fixture: UI animations, moderate complexity
- `many-cuts` fixture: Rapid transitions, high frame diversity
- `style-1-prod` fixture: Production-style composition (tagged slow)

### Metrics Per Experiment
- **Total render time** (ms)
- **Per-frame capture time** (ms)
- **Peak memory usage** (MB)
- **Output quality**: PSNR comparison against baseline (must match or exceed)
- **Speedup factor**: baseline_time / experiment_time

### Baseline Run
Run each fixture 3x with current default settings, record average per-stage timing.

## Success Criteria

- At least one experiment achieves 10x speedup on at least one fixture
- Output quality (PSNR) matches baseline within tolerance (>30dB)
- Approach is implementable without forking Chromium source
