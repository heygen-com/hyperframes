---
title: "Frame sources"
description: "Run deterministic scene code on the HyperFrames timeline."
---

HyperFrames can drive scene code that exposes a function of time without converting it to GSAP. Register that function against a timed host using `window.__hyperframes.registerFrameSource` before runtime initialization completes.

```javascript
const unregister = window.__hyperframes.registerFrameSource({
  element: document.getElementById("scene"),
  ready: initializeScene(),
  render: (sourceTime, signal) => drawScene(sourceTime, signal),
  dispose: () => releaseScene(),
});
```

The host uses the usual composition attributes: `data-composition-id`, `data-start`, `data-duration`, and `data-track-index`. Declare the root's dimensions, FPS, and duration. A frame source does not need a dummy GSAP timeline.

The callback receives seconds in source time: playback inpoint (`data-playback-start`) plus the rate-adjusted time since the host's resolved start. Existing playback rate and speed-ramp semantics apply. Timing is read again on every seek, so move, trim and rate edits do not require rewriting the animation code. Each overlapping scene needs its own source instance.

`ready` holds initialization and export capture. Return a promise from `render` when drawing is asynchronous: capture waits for it before taking pixels. Repeated and out-of-order times must produce the same frame. HyperFrames owns playback; do not start a second clock.

Draws are serialized per source. Rapid preview seeks coalesce while a draw is in flight; sequential export seeks draw every requested frame. Setup and draw failures are delivered to the capture completion barrier. A later successful seek can recover from a frame failure.

Call `unregister()` when replacing a source. Removal of its host or runtime teardown also unregisters it. The callback's `AbortSignal` is aborted, queued work is cancelled, capture waiters are released, and `dispose` runs once. Stop any underlying work in response to the signal or in `dispose`; cancellation cannot forcibly interrupt synchronous JavaScript.

Registration does not expose arbitrary scene code as editable keyframes. Manual element edits need stable identities and persistent parameters or overrides. Imported iframe sources also need screenshot capture and an explicit message bridge; this API does not grant access to sandboxed DOM.
