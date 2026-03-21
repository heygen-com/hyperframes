# Producer Pipeline

Renders sandbox-studio HTML/GSAP compositions into MP4 video.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ENTRY POINTS                                                           │
│                                                                         │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────────────────┐ │
│  │  Frontend UI  │   │   CLI (host)  │   │  Backend API (sandbox-studio)│ │
│  │  useRender()  │──▶│   cli.ts      │   │  routes/render.ts           │ │
│  │  api/render   │   │              │   │                              │ │
│  └──────┬───────┘   └──────┬───────┘   └──────────────┬───────────────┘ │
│         │                  │                           │                 │
│         │  HTTP POST       │  renderComposition()      │  spawn tsx      │
│         ▼                  ▼                           ▼                 │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │                    internal-render.ts                                │ │
│  │              (runs in Docker or locally via tsx)                     │ │
│  └─────────────────────────┬───────────────────────────────────────────┘ │
│                            │                                             │
│                            ▼                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │                   renderOrchestrator.ts                              │ │
│  │                  (6-stage pipeline below)                            │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

## Pipeline Stages

```
  index.html (raw)
       │
       ▼
┌──────────────────────────────────────────────────────────────────────┐
│  STAGE 1: Parse Composition                                          │
│                                                                      │
│  index.html ──▶ htmlCompiler.ts ──▶ compiled HTML                    │
│                  • adds data-end = data-start + data-duration        │
│                  • adds data-has-audio="true" to <video> tags        │
│                                                                      │
│  compiled HTML ──▶ parseCompositionStatic()                          │
│                     • reads data-width / data-height from root       │
│                     • parseVideoElements() → VideoElement[]          │
│                     • parseAudioElements() → AudioElement[]          │
│                     • reads data-composition-duration                │
│                                                                      │
│  Sub-compositions (data-composition-src):                            │
│    For each sub-comp reference in the main HTML:                     │
│      1. Read sub-composition file from project dir                   │
│      2. Compile through htmlCompiler (add data-end, etc.)            │
│      3. Parse video/audio elements                                   │
│      4. Offset start/end times by parent's data-start               │
│      5. Merge into main composition's element lists                  │
│                                                                      │
│  If duration = 0 (runtime GSAP):                                     │
│    starts fileServer → launches Puppeteer probe session               │
│    → window.__player.getDuration() → discovers real duration         │
│                                                                      │
│  Output: CompositionMetadata { duration, width, height, videos,      │
│                                audios }                              │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  STAGE 2: Extract Video Frames                     [videoFrameExtractor] │
│                                                                      │
│  For each <video> in composition:                                    │
│    1. Resolve source (local path or download remote URL)             │
│    2. FFmpeg extracts frames at composition FPS                      │
│    3. Frames saved to work/video-frames/<videoId>/frame_NNNNNN.jpg   │
│                                                                      │
│  Creates FrameLookupTable:                                           │
│    getFramePath(videoId, globalTimeSeconds) → /path/to/frame.jpg     │
│                                                                      │
│  Why: Browser <video> can't seek frame-accurately.                   │
│       We pre-extract and inject frames as images during capture.     │
│                                                                      │
│  Skipped if no <video> elements.                                     │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  STAGE 3: Process Audio                                [audioMixer] │
│                                                                      │
│  For each <audio> and <video data-has-audio="true">:                 │
│    1. Resolve source (local or remote)                               │
│    2. Extract audio stream (ffmpeg -vn for videos)                   │
│    3. Trim to data-media-start / duration                            │
│                                                                      │
│  FFmpeg complex filter mixes all tracks:                             │
│    • Per-track delay (data-start), volume, duration                  │
│    • Padded to composition duration                                  │
│    • Output: work/audio.aac                                          │
│                                                                      │
│  Skipped if no audio elements.                                       │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  STAGE 4: Frame Capture                              [frameCapture] │
│                                                                      │
│  ┌─────────────┐    HTTP     ┌──────────────────────────────┐        │
│  │  File Server │◀───────────│      Puppeteer Browser       │        │
│  │  (Hono)     │────────────▶│                              │        │
│  │             │   serves    │  Page loads composition      │        │
│  │  Injects:   │   assets    │                              │        │
│  │  • interceptor.js         │  For frame i = 0..N:         │        │
│  │  • renderSeek.js          │    1. renderSeek(i / fps)    │        │
│  └─────────────┘             │    2. Inject video frames    │        │
│                              │       from FrameLookupTable  │        │
│       project/               │    3. page.screenshot()      │        │
│       ├── index.html         │    4. Save frame_NNNNNN.jpg  │        │
│       ├── style.css          │                              │        │
│       └── assets/            └──────────────────────────────┘        │
│                                                                      │
│  renderSeek() = seeks GSAP timeline + pauses all media               │
│  interceptor.js = manages __player API, media sync, GSAP setup       │
│                                                                      │
│  Currently forced sequential (1 worker).                             │
│  Parallel infrastructure exists but is disabled.                     │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  STAGE 5: Encode Video                              [chunkEncoder]  │
│                                                                      │
│  FFmpeg encodes frame sequence → MP4:                                │
│                                                                      │
│    ffmpeg -framerate {fps}                                           │
│           -i frame_%06d.jpg                                          │
│           -c:v libx264 -crf {quality} -preset {speed}               │
│           -pix_fmt yuv420p                                           │
│           -s {width}x{height}                                        │
│           video-only.mp4                                             │
│                                                                      │
│  Quality presets:                                                     │
│    draft    → crf 28, ultrafast                                      │
│    standard → crf 23, medium                                         │
│    high     → crf 18, slow                                           │
│                                                                      │
│  GPU encoding auto-detected if --gpu:                                │
│    macOS: VideoToolbox  │  NVIDIA: NVENC                             │
│    Linux: VAAPI         │  Intel: QSV                                │
│                                                                      │
│  Output: work/video-only.mp4                                         │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  STAGE 6: Assemble                                  [chunkEncoder]  │
│                                                                      │
│  If audio exists:                                                    │
│    ffmpeg -i video-only.mp4 -i audio.aac                             │
│           -c:v copy -c:a aac                                         │
│           -movflags +faststart                                       │
│           output.mp4                                                 │
│                                                                      │
│  If no audio:                                                        │
│    ffmpeg -i video-only.mp4                                          │
│           -c copy -movflags +faststart                               │
│           output.mp4                                                 │
│                                                                      │
│  Cleanup: removes work directory                                     │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
                          output.mp4
```

## File Map

```
producer/
├── src/
│   ├── cli.ts                        # Host CLI: parses args, calls Docker
│   ├── internal-render.ts            # Container/local entry: parses args → orchestrator
│   ├── index.ts                      # Public exports
│   │
│   ├── services/
│   │   ├── renderOrchestrator.ts     # 6-stage pipeline coordinator
│   │   ├── htmlCompiler.ts           # Normalizes HTML (adds data-end, etc.)
│   │   ├── fileServer.ts             # Hono HTTP server for Puppeteer
│   │   ├── frameCapture.ts           # Puppeteer screenshot loop
│   │   ├── videoFrameExtractor.ts    # FFmpeg video → frame images
│   │   ├── audioMixer.ts             # FFmpeg audio extraction + mixing
│   │   ├── chunkEncoder.ts           # FFmpeg frame encoding + muxing
│   │   └── parallelCoordinator.ts    # Multi-worker coordination (disabled)
│   │
│   └── utils/
│       ├── dockerRender.ts           # Docker image build + container run
│       ├── renderComposition.ts      # Path resolution helper
│       ├── ffprobe.ts                # Media metadata (duration, codec, etc.)
│       └── urlDownloader.ts          # Downloads remote URLs to temp files
│
├── Dockerfile                        # Chromium + FFmpeg + Node.js image
├── docker-compose.yml
├── build.mjs                         # esbuild bundler for Docker
└── package.json
```

## Data Types

```
RenderConfig {
  fps: 24 | 30 | 60
  quality: "draft" | "standard" | "high"
  workers?: number
  useGpu?: boolean
}

CompositionMetadata {
  duration: number          // seconds
  width: number             // from data-width
  height: number            // from data-height
  videos: VideoElement[]
  audios: AudioElement[]
}

VideoElement {
  id: string
  src: string               // local path or URL
  start: number             // composition time (seconds)
  end: number               // computed by htmlCompiler
  mediaStart: number        // offset into source video
  hasAudio: boolean         // injected by htmlCompiler
}

AudioElement {
  id: string
  src: string
  start: number
  end: number
  mediaStart: number
  layer: number
  volume: number
  type: "audio" | "video"   // video = extract audio from video
}

FrameLookupTable {
  getFramePath(videoId, globalTime) → string | null
  cleanup() → void          // removes temp frame dirs
}
```

## HTML Compilation

The authored HTML uses `data-start`, `data-duration`, and `data-media-start`.
The pipeline's parsers expect `data-end` and `data-has-audio`.

`htmlCompiler.ts` bridges this gap before any parsing happens:

```
Before:
  <video src="clip.mp4" data-start="2" data-duration="5" data-media-start="10">

After:
  <video src="clip.mp4" data-start="2" data-duration="5" data-media-start="10"
         data-end="7" data-has-audio="true">
```

## Resolution Handling

Dimensions are read from the root composition element, not preset:

```html
<div data-composition-id="main" data-width="1080" data-height="1920">
```

This means portrait (1080x1920), landscape (1920x1080), square (1080x1080),
or any custom resolution is automatically respected.

Falls back to 1920x1080 if attributes are missing.

## Rendering Mode

The file server injects two scripts into the served `index.html`:

1. **Interceptor script** — The same one sandbox-studio uses. Sets up `window.__player`
   with play/pause/seek, manages GSAP timeline registration, syncs media elements.

2. **Render mode script** — Adds `window.__player.renderSeek(time)` which:
   - Seeks the GSAP master timeline to exact time
   - Pauses all `<video>` and `<audio>` elements
   - Sets `window.__renderReady = true` when complete

During capture, Puppeteer calls `renderSeek(t)` for each frame, then replaces
`<video>` elements with pre-extracted frame images for pixel-accurate output.

## Progress & Observability

Every stage logs with `[Orchestrator]` prefix:
- Stage timing and throughput (frames/sec, bytes)
- System resources (CPU cores, free memory)
- Video/audio element details (src, timing, extraction counts)
- Browser console output forwarded with `[Browser]` prefix
- On failure: full diagnostic dump (stage, error, stack, memory, last 20 browser console lines)

Frontend receives progress via SSE stream with status, percentage, and stage name.

## Parity Gate

Use `pnpm parity:check` in `producer/` to enforce preview vs producer checkpoint parity.

Recommended fixture coverage:

- nested compositions (`data-composition-src`)
- GSAP callbacks (`tl.call`, `onUpdate`)
- CSS/WAAPI-driven animation elements
- transformed video tracks (x/y/scale/rotation/skew)
- text/font loading edge cases

Suggested threshold:

- strict mode: `--allow-mismatch-ratio 0`
- rollout mode: temporary non-zero threshold only while fixing known deltas

## Regression Gate (Fixture vs Golden)

Use `pnpm regression:check` in `producer/` as a hard gate for renderer regressions.

Test suites are organized in `producer/tests/` with this structure:

```
tests/
├── test-1/
│   ├── src/              # Isolated project directory
│   │   └── index.html   # Entry point
│   ├── output.mp4        # Golden baseline
│   └── meta.json         # Test config (thresholds, checkpoints)
└── test-2/
    └── ...
```

What the harness validates:

- **Visual parity**: frame-level PSNR checks at configured checkpoints
- **Audio parity**: mono RMS-envelope cross-correlation with bounded lag search

Thresholds are configured per-test in `meta.json` (defaults: `minPsnr: 30`, `maxFrameFailures: 0`, `minAudioCorrelation: 0.9`).

The command exits non-zero if either visual or audio gate fails.

Commands:

- `pnpm regression:check` — Run all tests
- `pnpm regression:check test-1` — Run specific test
- `pnpm regression:update` — Update all golden baselines
- `pnpm regression:update test-1` — Update specific golden

See `producer/tests/README.md` for test structure and adding new tests.
