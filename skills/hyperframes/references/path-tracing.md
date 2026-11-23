# Path-traced 3D

Path tracing gives real soft shadows, light bouncing between objects and reflections of the scene, at many times the cost of raster (75 times the export time in the measurement below). Start from the `path-traced-3d` example (`npx hyperframes init <dir> --example path-traced-3d`): a Three.js scene with a fast raster preview and an opt-in path-traced export, with three, three-gpu-pathtracer (WebGL) and three-mesh-bvh vendored as one pinned local file, so a 2D project never loads the tracer. Edit `assets/scene.js`; `assets/render.js` holds the contract below.

## Raster or path

| Variable                       | Use                                                                                   | Cost                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `renderer: "raster"` (default) | Previews, drafts, timing, the Studio preview                                          | Milliseconds a frame                                           |
| `renderer: "path"`             | The final export, when bounced light, soft shadows or inter-reflections are the point | Every frame traces `samples` passes of up to `bounces` bounces |

Preview in raster, then export once: `npx hyperframes render --variables '{"renderer":"path","samples":64}'`. Measured on an Apple M4 Max with a hardware GPU for an 8 s 720p clip: raster 10.8 s, path traced 810.5 s at 32 samples per pixel and 6 bounces. Noise falls with the square root of the samples, so halving it costs four times the samples, and every extra bounce makes each path longer; the example defaults to 64 samples and 4 bounces.

Without a hardware GPU, Chrome draws WebGL in software: on SwiftShader the tracer's first shader run alone took about a minute at 320×180, longer than the default 45 s readiness wait. Test path mode there at a few hundred pixels wide and 1 to 2 samples, and raise the wait: `--timeout 170000` for `check` and `snapshot`, `--player-ready-timeout 180000` for `render`. A setup that times out can be reported as "Composition has zero duration".

## The contract

- Setup is one `window.__hf.buildReady["<key>"]` promise: build the scene, `await renderer.compileAsync(scene, camera)`, construct the tracer, then draw one throwaway frame and read one pixel back. The first frame a renderer draws differs from later ones, and the readback makes the GPU finish that first, slowest run inside setup; `gl.finish()` can return before a software GPU has run the work.
- Draw only inside the `hf-seek` listener and register the work synchronously: `e.detail.waitUntil(promise)`. Queue each seek behind the previous one. Never start a loop (`renderer.setAnimationLoop`, a `requestAnimationFrame` loop).
- Every visible thing is a function of `e.detail.time`. Each new time calls `tracer.setScene` (objects moved) and accumulates exactly `samples` passes from zero; a repeat seek to the time already on the canvas does no work. Drive sampling by that count, never by elapsed time or the tracer's own "done" state.
- Set `tracer.renderDelay = 0`, `fadeDuration = 0`, `minSamples = 1`, `dynamicLowRes = false`, `rasterizeScene = false` and `stableNoise = true`. The tracer times its delay and fade with `THREE.Clock`, which reads a clock that does not move during a render.
- Seed `Math.random` while you build the scene and construct the tracer, then restore it. Anything created later (a model loaded during setup) must be built under the seed too. Three's object uuids come from it and set the order the tracer sorts lights, meshes and textures in, and the tracer builds its noise textures from it, so without a seed every page load (every render worker) draws different grain, which jumps where one worker's frames meet the next. Local renders leave `Math.random` native; only distributed renders seed it.
- Keep the set of lights and material features fixed over time. A change that alters the tracer's shader starts a compile inside a seek.

## The frozen clock

During a render `Date.now()` and `performance.now()` return the current seek time and do not move between seeks (0 until the first seek), and `requestAnimationFrame` callbacks wait until a seek, and the first seek waits for every `buildReady` promise. So setup that awaits an animation frame or waits for the clock to advance never finishes. Composition code uses no timers of its own; await the libraries' readiness promises instead:

- Raster: `await renderer.compileAsync(scene, camera)`.
- three-gpu-pathtracer 0.0.24 shows compilation only as the `isCompiling` flag. The promise behind it is three's `compileAsync`, so the example awaits that, `tracer._pathTracer._compilePromise`, in one small helper after any `renderSample` that leaves `isCompiling` set. It only decides when drawing may start, never what is drawn.

Never wait with `scheduler.yield()`: its continuations run ahead of timers, so a loop that yields until a compile finishes starves the `setTimeout` poll inside `compileAsync`, and the page hangs, with or without HyperFrames. Do not replace `renderer.compileAsync` with the synchronous `compile` to get around a hang; fix the wait.

## Check it

Snapshot a time, an earlier time, then the first again in one run: `npx hyperframes snapshot --at 4,0,4 --no-end`. The two stills at 4 s must be byte-identical. Then render a short clip and look at the frames themselves, not just the exit code. The example's `source/verify-render.mjs` in the HyperFrames repository does both in raster and path mode, renders path mode on two workers and checks that a new page load draws the same still.
