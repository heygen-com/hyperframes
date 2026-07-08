# @hyperframes/browser-export

Render a HyperFrames composition to MP4/WebM **entirely in the browser** — no server, no FFmpeg, no headless Chrome (upstream discussion: heygen-com/hyperframes#1661).

Frames are sampled with the same quantized deterministic seek the producer uses, rasterized via SVG `foreignObject` ([html-to-image](https://github.com/bubkoo/html-to-image)) and encoded with WebCodecs through [mediabunny](https://mediabunny.dev).

```bash
npm install @hyperframes/browser-export
```

## Quick start

```ts
import { exportComposition, downloadExport } from "@hyperframes/browser-export";

// The composition must be live in the page (or a same-origin iframe document):
// GSAP timelines registered in window.__timelines, root carrying
// data-composition-id / data-width / data-height.
const result = await exportComposition(document, {
  fps: 30,
  format: "mp4", // or "webm"
  onProgress: ({ phase, fraction }) => console.log(`${phase} ${(fraction * 100).toFixed(0)}%`),
});

downloadExport(result); // "<composition-id>.mp4"
```

## How it works

1. **Plan** — finds the composition root (`[data-composition-id]` or `#root`), reads dimensions, resolves the duration from the master GSAP timeline in `window.__timelines` (or `options.duration`).
2. **Audio** — parses `<audio>`/`<video>` elements (`data-start`, `data-duration`/`data-end`, `data-media-start`, `data-volume` — the producer's contract), decodes them and mixes offline with `OfflineAudioContext` into one track.
3. **Video** — for each frame: pause + seek every registered timeline at the quantized frame time (`Math.round(t·fps)/fps`, the producer's parity contract), await `<video>` layer seeks, rasterize the root to a canvas, hand the canvas frame to mediabunny's `CanvasSource`.
4. **Encode** — WebCodecs via mediabunny (`avc`+`aac` in MP4, `vp9`+`opus` in WebM), finalized into a `Blob`.

## API

| Export                                                            | Description                                                                                                       |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `exportComposition(target, options?)`                             | Full pipeline → `ExportResult { blob, mimeType, width, height, fps, durationSeconds, frameCount, compositionId }` |
| `downloadExport(result, filename?)`                               | Trigger a client-side download                                                                                    |
| `collectAudioClips(scope)` / `mixAudioClips(clips, duration)`     | Audio pipeline pieces                                                                                             |
| `seekTimelines(registry, t, fps)` / `quantizeTimeToFrame(t, fps)` | Deterministic seek pieces                                                                                         |
| `findCompositionRoot(scope)` / `readCompositionMeta(root)`        | Composition discovery                                                                                             |

`ExportOptions`: `fps` (30), `format` ("mp4"), `duration`, `videoBitrate`, `audioBitrate`, `includeAudio` (true), `pixelRatio` (1), `keyFrameIntervalSeconds` (2), `signal`, `onProgress`.

## Limitations (vs the server producer)

This pipeline **complements** `@hyperframes/producer` — it does not replace it. The producer remains the reference for deterministic, pixel-perfect renders.

- Requires WebCodecs (Chrome/Edge 94+, Safari 16.4+, Firefox 130+).
- SVG `foreignObject` rasterization: cross-origin images/fonts must be CORS-readable; some exotic CSS (e.g. backdrop-filter) may differ from a real Chrome screenshot.
- `<video>` layers are frame-aligned via async seeks with a 500 ms guard — long-GOP sources may land on the nearest decodable frame.
- Rendering happens on the main thread; a 30 s / 30 fps export is ~900 sequential rasterizations.
