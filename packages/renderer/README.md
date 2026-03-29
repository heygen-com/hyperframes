# @hyperframes/renderer

High-performance HTML-to-video renderer for HyperFrames compositions.

Uses pipelined CDP with pipe transport for fast frame capture and streams
frames directly to FFmpeg for concurrent capture + encoding.

## Key Optimizations

| Optimization | What It Does | Speedup |
|-------------|-------------|---------|
| Pipe transport | `--remote-debugging-pipe` instead of WebSocket | Lower latency |
| Pipelined CDP | Fire seek WITHOUT await, then beginFrame immediately | 1.4x per frame |
| Streaming encode | Pipe frames to FFmpeg during capture, not after | Eliminates encode stage |
| Damage-aware reuse | Skip screenshot for static frames | Fewer bytes to encode |
| GPU auto-detect | Uses GPU rasterization + NVENC when available | 10-30x on GPU hardware |

## Usage

### As a library

```typescript
import { turboRender } from "@hyperframes/renderer";

const result = await turboRender({
  url: "http://localhost:3000/index.html",
  width: 1080,
  height: 1920,
  fps: 30,
  duration: 15,
  outputPath: "./output.mp4",
  verbose: true,
  onProgress: (frame, total, avgMs) => {
    console.log(`${frame}/${total} (${avgMs.toFixed(1)}ms/frame)`);
  },
});

console.log(`Done in ${result.totalMs}ms, ${result.outputSize} bytes`);
```

### GPU acceleration

On machines with NVIDIA GPUs:

```typescript
const result = await turboRender({
  url: "http://localhost:3000/index.html",
  width: 1080,
  height: 1920,
  fps: 30,
  outputPath: "./output.mp4",
  useGpuRendering: true,  // GPU rasterization instead of SwiftShader
  useGpuEncoding: true,   // NVENC instead of libx264
  preset: "p4",           // NVENC preset
});
```

## Benchmark Results

### CPU-only machine (8-core AMD EPYC, no GPU)

| Metric | Standard Engine | Turbo Renderer |
|--------|----------------|---------------|
| Transport | WebSocket | Pipe |
| Per-frame | 10ms (6 workers) | 26ms (1 worker) |
| Encoding | Sequential (3.2s) | Concurrent (0.1s drain) |
| Total (450 frames) | 8,540ms | ~57,000ms (1 worker) |

**Note:** On CPU-only machines, the bottleneck is SwiftShader (CPU GL rasterization).
The turbo renderer is designed to shine on GPU machines where rasterization is 10-50x faster.

### Expected on GPU machine (NVIDIA A10G)

| Metric | Standard Engine (CPU) | Turbo Renderer (GPU) |
|--------|----------------------|---------------------|
| Rasterization | 15-25ms (SwiftShader) | 1-2ms (GPU) |
| Encoding | 3.2s (libx264) | 0.3s (NVENC) |
| Total (450 frames) | 8,540ms | ~600-1,200ms |
| **Speedup** | — | **7-14x** |
