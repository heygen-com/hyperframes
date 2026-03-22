# Producer

Renders HyperFrames compositions (HTML + assets) to MP4 video via Docker (Puppeteer + FFmpeg).

## Usage

```bash
pnpm render <project-dir>                    # renders to renders/<dir-name>.mp4
pnpm render <project-dir> -o output.mp4      # custom output path
pnpm render <project-dir> -q draft -r 720p   # draft quality, 720p
```

`<project-dir>` must contain an `index.html` entry file (plus any referenced local assets).

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `-o, --output <path>` | Output file path | `renders/<dir-name>.mp4` |
| `-r, --resolution <res>` | `720p`, `1080p`, `4k` | `1080p` |
| `-f, --fps <N>` | `24`, `30`, `60` | `30` |
| `-q, --quality <level>` | `draft`, `standard`, `high` | `standard` |
| `--no-build` | Skip auto-build and Docker image rebuild | |
| `--verbose` | Verbose output | |

## Architecture

The producer has a two-layer design: host-side orchestration and a Docker-side render pipeline.

### Host side (runs on your machine via `tsx`)

- **`src/cli.ts`** — CLI entry point. Parses args, auto-builds `dist/` if source files changed, then delegates to `renderViaDocker()`.
- **`src/utils/dockerRender.ts`** — Builds the Docker image (with dist hash change detection) and runs it with the project directory mounted at `/input`.

### Docker side (runs inside the container)

**`dist/internal-render.js`** — Bundled from `src/internal-render.ts`. Runs the 6-step pipeline:

1. **Inject interceptor** into HTML (Cheerio) — hooks into `window.__player`
2. **Start file server** (Hono) — serves the project directory locally
3. **Launch Puppeteer** — loads the page, waits for the player to be ready
4. **Capture frames** — screenshots at each time step
5. **Encode video** — frames to H.264 via FFmpeg
6. **Process audio & mux** — extract/mix audio, combine with video into final MP4

### Key files

| File | Purpose |
|------|---------|
| `src/cli.ts` | CLI entry point (host) |
| `src/internal-render.ts` | Render pipeline (Docker) |
| `src/utils/dockerRender.ts` | Docker image build & run |
| `src/utils/htmlInjector.ts` | Injects interceptor script into HTML |
| `src/utils/interceptor.ts` | Injected JS that hooks `window.__player` |
| `src/utils/fileServer.ts` | Hono static file server |
| `src/services/frameCapture.ts` | Puppeteer frame capture |
| `src/services/videoEncoder.ts` | FFmpeg frame encoding + muxing |
| `src/services/audioExtractor.ts` | Audio extraction from HTML elements |
| `build.mjs` | esbuild bundler config |

## Build

The CLI auto-builds before each render (comparing source mtimes against `dist/internal-render.js`). You can also build manually:

```bash
pnpm build    # bundles src/internal-render.ts → dist/internal-render.js
```

The build bundles everything except Puppeteer (which is installed via npm inside the Docker image).

## Parity Harness

Use the parity harness to compare preview and producer at deterministic checkpoints.

```bash
pnpm parity:check \
  --preview-url "http://localhost:<PORT>/api/projects/<id>/serve/index.html?parity=1" \
  --producer-url "http://localhost:8787/index.html" \
  --checkpoints "0,1,2,3,5" \
  --fps 30 \
  --allow-mismatch-ratio 0
```

Behavior:

- waits for `__playerReady` + `__renderReady` on both pages
- performs quantized seek at each checkpoint
- captures PNG screenshot buffers
- compares SHA-256 hashes and fails if mismatch ratio exceeds threshold

This command is CI-gate friendly because it exits non-zero on failure.

## Regression Harness (Hard Gate)

Use this to catch producer regressions against the canonical fixture pair:

- HTML fixture: `core/src/tests/1.html`
- Golden render: `core/src/tests/1.mp4`

```bash
pnpm regression:check
```

Default gate behavior:

- visual checks: PSNR at checkpoints `0,1,2,3,5` seconds
- audio checks: RMS-envelope correlation with drift window tolerance
- exits non-zero when thresholds are breached

Useful flags:

```bash
pnpm regression:check -- --min-psnr 30 --max-frame-failures 0 --min-audio-correlation 0.9
pnpm regression:check -- --checkpoints "0,0.5,1,2,4"
pnpm regression:check -- --keep-temp true
```

To intentionally refresh baseline after verified changes:

```bash
pnpm regression:update
```

## Exports

This package is CLI-only — it has no library API or `exports` field. All usage goes through `pnpm render`.
