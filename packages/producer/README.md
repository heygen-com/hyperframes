# @hyperframes/producer

Full HTML-to-video rendering pipeline: capture frames with Chrome's BeginFrame API, encode with FFmpeg, mix audio — all in one call.

## Install

```bash
npm install @hyperframes/producer
```

**Requirements:** Node.js >= 22, Chrome/Chromium (auto-downloaded), FFmpeg

## Usage

### Render a video

```typescript
import { createRenderJob, executeRenderJob } from "@hyperframes/producer";

const job = createRenderJob({
  inputPath: "./my-composition.html",
  outputPath: "./output.mp4",
  width: 1920,
  height: 1080,
  fps: 30,
});

const result = await executeRenderJob(job, (progress) => {
  console.log(`${Math.round(progress.percent * 100)}%`);
});

console.log(result.outputPath); // ./output.mp4
```

### Run as an HTTP server

The producer can also run as a render server, accepting render requests over HTTP:

```typescript
import { startServer } from "@hyperframes/producer";

await startServer({ port: 8080 });
// POST /render with a RenderConfig body
```

### Configuration

`RenderConfig` controls the render pipeline:

| Option             | Default      | Description                                                                                                                                              |
| ------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inputPath`        | —            | Path to the HTML composition                                                                                                                             |
| `outputPath`       | —            | Output video file path (or directory, for `format: "png-sequence"`)                                                                                      |
| `width`            | 1920         | Frame width in pixels                                                                                                                                    |
| `height`           | 1080         | Frame height in pixels                                                                                                                                   |
| `fps`              | 30           | Frames per second (24, 30, or 60)                                                                                                                        |
| `quality`          | `"standard"` | Encoder preset (`"draft"`, `"standard"`, `"high"`)                                                                                                       |
| `format`           | `"mp4"`      | Output container — `"mp4"`, `"webm"`, `"mov"`, or `"png-sequence"`. See [Transparent Video Output](#transparent-video-output) below.                     |
| `videoFrameFormat` | `"auto"`     | Source video frame extraction format — `"auto"`, `"jpg"`, or `"png"`. Use `"png"` for UI recordings, screen captures, and color-sensitive source videos. |

## Transparent Video Output

The producer can render HTML compositions to formats that carry a **true alpha channel** — not chroma key. The same composition that renders an opaque MP4 renders a layerable overlay when you set `format`.

| `format`          | Codec / pixel format              | Alpha                   | Audio               | Use case                                                                                |
| ----------------- | --------------------------------- | ----------------------- | ------------------- | --------------------------------------------------------------------------------------- |
| `"mp4"` (default) | H.264 (yuv420p) or H.265 + HDR10  | No                      | AAC                 | Streaming, social, default deliverable                                                  |
| `"webm"`          | VP9 + yuva420p                    | **True alpha**          | Opus                | Web playback as overlay (`<video>` over background); supported in Chrome, Edge, Firefox |
| `"mov"`           | ProRes 4444 + yuva444p10le        | **True alpha + 10-bit** | AAC                 | Editor ingest (Premiere, Final Cut Pro, DaVinci Resolve)                                |
| `"png-sequence"`  | Numbered RGBA PNGs in a directory | **Lossless alpha**      | Sidecar `audio.aac` | After Effects / Nuke / Fusion, or pipelines that post-process frames before encoding    |

### Example

```typescript
import { createRenderJob, executeRenderJob } from "@hyperframes/producer";

const job = createRenderJob({
  inputPath: "./my-composition.html",
  outputPath: "./output.webm", // or a directory for "png-sequence"
  width: 1080,
  height: 1920,
  fps: 30,
  format: "webm", // "mp4" | "webm" | "mov" | "png-sequence"
});

await executeRenderJob(job);
```

### What "transparent background" means here

The producer captures Chrome screenshots with the page background forced transparent (`html, body, [data-composition-id] { background: transparent !important }`) and the CDP default background override set to RGBA 0,0,0,0. The captured PNGs carry a real alpha channel and that channel is preserved end-to-end:

- VP9 (`webm`) is encoded with `-pix_fmt yuva420p`, `-auto-alt-ref 0`, and `alpha_mode=1` metadata.
- ProRes 4444 (`mov`) is encoded with `-pix_fmt yuva444p10le`.
- PNG sequences are written without re-encoding (zero-padded `frame_NNNNNN.png`).

This is not chroma keying. There is no green/blue background to remove and no "key" tolerance to tune — pixels that were transparent in the browser are transparent in the output.

### Caveats

- **Linux + alpha forces screenshot capture.** Chrome's BeginFrame compositor (the default deterministic capture path on Linux headless-shell) does not preserve alpha; the orchestrator falls back to `Page.captureScreenshot`, which is slower per frame. macOS and Windows already use screenshot mode by default, so they are unaffected.
- **HDR + alpha is not supported.** Setting `hdr: true` together with an alpha-capable format logs a warning and falls back to SDR. Use `format: "mp4"` for HDR10 output.
- **`png-sequence` does not produce a single muxed file.** When the composition contains audio elements, an `audio.aac` sidecar is written alongside the PNGs in `outputPath`.
- **Safari + WebM alpha is incomplete.** For broad browser playback of an alpha video, ship `format: "mov"` to your editor and re-encode for the codec your distribution target supports.

### Authoring transparent compositions

Don't paint a fullscreen background in your HTML. The default body background is overridden to transparent automatically — any `body { background: ... }`, `#root { background: ... }`, or `[data-composition-id] { background: ... }` rule is force-overridden during alpha rendering. Backgrounds on inner elements (cards, scenes, components) are kept.

## Distributed rendering

For renders too large for a single machine, the producer ships a public set of distributed-render primitives. They are pure functions over local file paths — networking and orchestration live in adapter packages (Temporal, AWS Lambda + Step Functions, Cloud Run Jobs, K8s Jobs).

```typescript
import { plan, renderChunk, assemble } from "@hyperframes/producer/distributed";

// Controller-side: produce a self-contained planDir + content-addressed planHash.
const planResult = await plan(
  projectDir,
  { fps: 30, width: 1920, height: 1080, format: "mp4" },
  "/tmp/plan",
);

// Worker-side: render one chunk. Byte-identical retries on the same
// `(planDir, chunkIndex)` — Temporal / Step Functions retry policies are safe
// to point at this.
const chunk = await renderChunk("/tmp/plan", 0, "/tmp/chunks/0.mp4");

// Controller-side: stitch chunks into the final deliverable.
await assemble(
  "/tmp/plan",
  ["/tmp/chunks/0.mp4", "/tmp/chunks/1.mp4"],
  "/tmp/plan/audio.aac",
  "/tmp/output.mp4",
);
```

The three activity functions plus their result types are also re-exported from `@hyperframes/producer` so callers that pin the main package don't need a separate subpath import. Supported formats: `mp4` SDR, `mov` ProRes 4444, and `png-sequence`. webm and HDR mp4 trip a typed `FormatNotSupportedInDistributedError` — use the in-process renderer (`executeRenderJob`) for those.

## How it works

1. **Serve** — spins up a local file server for the HTML composition
2. **Capture** — opens the page in headless Chrome, seeks frame-by-frame via `HeadlessExperimental.beginFrame` (or `Page.captureScreenshot` for transparent / non-Linux renders), captures screenshots
3. **Encode** — pipes frames through FFmpeg (with GPU encoder detection and chunked concat). Skipped for `format: "png-sequence"`.
4. **Mix** — extracts `<audio>` elements and mixes them into the final video. For `png-sequence`, audio is written as an `audio.aac` sidecar.
5. **Finalize** — applies faststart for streaming-friendly MP4 (no-op for WebM, MOV, and `png-sequence`)

## Documentation

Full documentation: [hyperframes.heygen.com/packages/producer](https://hyperframes.heygen.com/packages/producer)

## Related packages

- [`@hyperframes/core`](../core) — types, parsers, frame adapters
- [`@hyperframes/engine`](../engine) — lower-level capture and encode primitives
- [`hyperframes`](../cli) — CLI
