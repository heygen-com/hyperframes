# Studio

## Architecture

The **frontend** is fully isolated from `core/` and `core_v2/`. It does NOT import, read, or depend on any code from those packages. Keep it that way.

The **backend** depends on `@hyperframes/core` for shared utilities:
- **Timing compilation** (`compileTimingAttrs`, `injectDurations`) — resolves `data-duration="auto"` etc.
- **Hyperframe runtime source** (`loadHyperframeRuntimeSource`) — bundled runtime injected into served HTML

The hyperframe runtime (modular sources under `core/src/runtime/`) handles:
1. Intercepting `gsap.timeline()` to capture the master timeline
2. Exposing `window.__player` (play/pause/seek/getTime/getDuration/isPlaying)
3. RAF-based media sync (video/audio playback tied to timeline position)
4. Visibility bookends from `data-start` + `data-duration`

If you need new playback features, add them to `core/src/runtime/` — do NOT pull in the core gsapInterceptor (that's for the deprecated editor).

## Data Attributes (core_v2 convention)

- `data-start` — start time in seconds
- `data-duration` — duration in seconds
- `data-track-index` — timeline track number
- `data-media-start` — media offset (optional)
- `data-volume` — audio/video volume 0-1 (optional)

## Ports

- Backend: 3002
- Frontend: 5175
