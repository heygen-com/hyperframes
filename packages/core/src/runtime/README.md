# Hyperframe Runtime Engine

This folder owns the runtime that powers preview and producer parity.

## Current Direction

- Runtime source of truth is converging on `hyperframe.ts`.
- Build produces:
  - `dist/hyperframe.runtime.iife.js` (browser bootstrap)
  - `dist/hyperframe.runtime.mjs` (tooling/tests)
  - `dist/hyperframe.manifest.json` (version + sha256 + artifact map)
- FE owns iframe runtime injection.
- BE persists raw generated HTML without injecting runtime scripts.
- Producer validates pinned runtime checksum from manifest before render.

## Runtime Contract (Stable Surface)

Globals:

- `window.__player`
- `window.__playerReady`
- `window.__renderReady`
- `window.__timelines`
- `window.__clipManifest`

postMessage:

- parent -> runtime control:
  - `source: "hf-parent"`
  - `type: "control"`
  - actions: `play`, `pause`, `seek`, `set-muted`, `set-playback-rate`, `enable-pick-mode`, `disable-pick-mode`
- runtime -> parent events:
  - `source: "hf-preview"`
  - `type: "state"` carries the whole `frame` and the exact `currentTime` in seconds; a
    film whose length falls between two frames ends at `currentTime`, not at a frame
  - `type: "timeline"` carries `assetsReady` (whether the
    composition's media, images and fonts have settled) and the runtime then posts
    `type: "assets-ready"` once, so a parent that cannot read the iframe can gate playback
  - `type: "ready"` — emitted once when `installRuntimeControlBridge` registers
    the control-message listener. The parent uses it to replay current playback
    state (`set-muted`, `set-volume`, `set-playback-rate`) so any control
    message sent before the listener was installed isn't lost. Emitted again on
    every iframe reload because the new runtime instance starts with no state.

Determinism baseline:

- `renderSeek` is the producer-canonical seek path.
- 30fps quantization and readiness gates are correctness requirements.

## Build

```bash
bun run --filter @hyperframes/core build:hyperframes-runtime
```

## Security Expectations

- Runtime bootstrap URL must be version-pinned and host-allowlisted.
- Iframe bridge payloads must be schema-validated.
- Unsafe URL schemes (`javascript:` and unapproved `data:`) are rejected.
- Fail closed if runtime bootstrap/handshake is not healthy.

## Product Editing Model

- Primary mode: prompt + element picking.
- Secondary mode: manual precision controls.
- Avoid timeline-first manual workflows as default product path.
