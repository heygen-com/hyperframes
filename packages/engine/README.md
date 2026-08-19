# @hyperframes/engine

Seekable web-page-to-video rendering engine built on Puppeteer and FFmpeg.

Framework-agnostic: works with GSAP, Lottie, Three.js, CSS animations, or any web content that implements the `window.__hf` seek protocol.

## Install

```bash
npm install @hyperframes/engine
```

**Requirements:** Node.js >= 22, Chrome/Chromium (auto-downloaded by Puppeteer), FFmpeg

## What it does

The engine opens your HTML composition in a headless Chrome instance, seeks frame-by-frame using Chrome's `HeadlessExperimental.beginFrame` API, captures screenshots, and encodes them into video with FFmpeg.

### Key services

| Service                 | Description                                                            |
| ----------------------- | ---------------------------------------------------------------------- |
| **browserManager**      | Launches and pools headless Chrome instances (`chrome-headless-shell`) |
| **frameCapture**        | Manages capture sessions — seek, screenshot, buffer lifecycle          |
| **screenshotService**   | BeginFrame-based capture with CDP (Chrome DevTools Protocol)           |
| **chunkEncoder**        | FFmpeg encoding with chunked concat, GPU detection, faststart          |
| **streamingEncoder**    | Pipe frames to FFmpeg in real time (no intermediate PNGs on disk)      |
| **audioMixer**          | Parse `<audio>` elements and mix audio tracks via FFmpeg               |
| **videoFrameExtractor** | Extract frames from `<video>` elements for compositing                 |
| **parallelCoordinator** | Split frame ranges across worker processes                             |
| **fileServer**          | Serve local HTML files to the browser via Hono                         |

## Usage

```typescript
import {
  acquireBrowser,
  createCaptureSession,
  initializeSession,
  captureFrame,
  closeCaptureSession,
} from "@hyperframes/engine";

// 1. Launch browser
const browserLease = await acquireBrowser({ captureMode: "beginFrame" });

// 2. Open a capture session
const session = createCaptureSession({
  browser: browserLease.browser,
  url: "http://localhost:3000/my-composition.html",
  width: 1920,
  height: 1080,
  fps: 30,
});
await initializeSession(session);

// 3. Capture frames
for (let i = 0; i < totalFrames; i++) {
  await captureFrame(session, i, `/tmp/frames/frame-${i}.png`);
}

// 4. Clean up
await closeCaptureSession(session);
await browserLease.release();
```

Most users should use `@hyperframes/producer` or the `hyperframes` CLI instead of calling the engine directly.

## Documentation

Full documentation: [hyperframes.heygen.com/packages/engine](https://hyperframes.heygen.com/packages/engine)

## Related packages

- [`@hyperframes/core`](../core) — types, parsers, frame adapters
- [`@hyperframes/producer`](../producer) — high-level render pipeline built on this engine
- [`hyperframes`](../cli) — CLI
