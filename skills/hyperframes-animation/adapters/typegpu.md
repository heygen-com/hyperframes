---
name: hyperframes-typegpu
description: TypeGPU and raw WebGPU adapter patterns for HyperFrames. Use when creating GPU-rendered compositions with TypeGPU, raw WebGPU, WGSL fragment shaders, compute pipelines, liquid glass effects, particle systems, or any canvas layer driven by navigator.gpu that responds to HyperFrames hf-seek events.
---

# TypeGPU / WebGPU for HyperFrames

HyperFrames supports TypeGPU and raw WebGPU through its `typegpu` runtime adapter. The adapter does not own your pipeline. It publishes HyperFrames time and dispatches a seek event so your composition can render the exact GPU frame.

## Render-environment prerequisite (WebGPU + html-in-canvas)

The render engine auto-passes `--enable-unsafe-webgpu` and `--enable-features=CanvasDrawElement` to its Chrome launch args. Stock Chromium and the bundled headless-shell **do not** support WebGPU + `drawElementImage` together — the combo that liquid-glass blocks need (`ios26-liquid-glass`, `macos-tahoe-liquid-glass`, `liquid-glass-*`, `vfx-liquid-glass`). For those blocks, point the engine at Brave (or Chrome canary) by setting `PRODUCER_HEADLESS_SHELL_PATH` to the browser binary before running `npx hyperframes render` / `preview`. Plain TypeGPU layers without HTML-as-texture work in headless-shell — only the html-in-canvas + WebGPU combination needs the override.

## Contract

- Initialize WebGPU asynchronously (`await navigator.gpu.requestAdapter()`), but register all GSAP tweens **synchronously** — before any `await`. The HyperFrames player reads the timeline immediately at page load.
- Render from HyperFrames time, not `performance.now()`.
- Listen for the `hf-seek` event and re-render at exactly that time.
- Guard against environments where WebGPU is unavailable — the adapter does not check for you.
- If the composition cannot render without WebGPU, add `data-requires-webgpu` to its composition root. Local capture commands then report an actionable error instead of capturing a no-GPU fallback screen when auto-detection selects software rendering.
- After submitting GPU work, register queue completion synchronously with `e.detail.waitUntil(device.queue.onSubmittedWorkDone())`. HyperFrames awaits registered work before screenshots and frame capture.

The adapter sets `window.__hfTypegpuTime` and dispatches an `hf-seek` event with `{ time, waitUntil }` on each seek. While Studio is paused, HyperFrames may dispatch the same time again to keep the WebGPU swapchain presented. Re-render that exact time; do not advance simulation state.

## Basic Pattern

```html
<canvas id="gpu-layer"></canvas>
<script>
  (async () => {
    if (!navigator.gpu) return;
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return;
    const device = await adapter.requestDevice();
    const canvas = document.getElementById("gpu-layer");
    canvas.width = 1920;
    canvas.height = 1080;
    const ctx = canvas.getContext("webgpu");
    const fmt = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format: fmt, alphaMode: "opaque" });

    // Build your pipeline, buffers, bind groups...
    const timeUniform = new Float32Array([0]);
    const timeBuf = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    function render(t) {
      timeUniform[0] = t;
      device.queue.writeBuffer(timeBuf, 0, timeUniform);
      const enc = device.createCommandEncoder();
      const pass = enc.beginRenderPass({
        colorAttachments: [
          {
            view: ctx.getCurrentTexture().createView(),
            loadOp: "clear",
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            storeOp: "store",
          },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
      device.queue.submit([enc.finish()]);
    }

    render(0);
    window.addEventListener("hf-seek", (e) => {
      render(e.detail.time);
      e.detail.waitUntil(device.queue.onSubmittedWorkDone());
    });
  })();
</script>
```

## Timeline Registration

GSAP tweens that drive text, captions, or HTML elements must be registered **synchronously** — before any `await`:

```js
const tl = gsap.timeline({ paused: true });

// Caption tweens: synchronous, added before WebGPU init
gsap.set(".cap", { opacity: 0 });
tl.to("#cap-1", { opacity: 1, duration: 0.3 }, 1.0);
tl.to("#cap-1", { opacity: 0, duration: 0.2 }, 3.5);

window.__timelines["my-comp"] = tl;

// GPU-dependent tweens can go inside the async IIFE
(async () => {
  // ... WebGPU init ...
  const proxy = { value: 0 };
  tl.to(proxy, { value: 1, duration: 2, onUpdate: render }, 0.5);
})();
```

## Video-Backed Effects (Liquid Glass, Distortion)

To use a `<video>` as the GPU input texture:

```js
const videoEl = document.getElementById("aroll");

// Wait for video metadata before creating the texture
await new Promise((r) => {
  if (videoEl.readyState >= 1) r();
  else videoEl.addEventListener("loadedmetadata", r, { once: true });
});

// Create texture at the video's NATIVE resolution
const vw = videoEl.videoWidth,
  vh = videoEl.videoHeight;
const bgTex = device.createTexture({
  size: [vw, vh],
  format: "rgba8unorm",
  usage:
    GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
});

function render(t) {
  try {
    device.queue.copyExternalImageToTexture({ source: videoEl }, { texture: bgTex }, [vw, vh]);
  } catch (_) {
    /* frame not decoded yet */
  }
  // ... draw ...
}
```

**Render-mode caveat:** headless Chrome may fail `copyExternalImageToTexture` for video elements. For production renders, pre-extract key frames via FFmpeg as PNGs and load them as image textures instead.

## Frosted Blur via Downsample Pass

A single-pass Gaussian kernel is too weak for glass-like frosted blur. Use a two-pass approach:

1. **Pass 1 — Downsample:** render the full-res texture to a small texture (1/6 resolution). Bilinear filtering during the downsample naturally averages pixels.
2. **Pass 2 — Glass composite:** sample the small texture for the frosted interior (bilinear upscale = heavy smooth blur) and the full-res texture for sharp areas and chromatic refraction.

This matches TypeGPU's `textureSampleBias` mip-level approach without generating mipmaps.

## Transparent vs Opaque Canvas

- **`alphaMode: 'opaque'`** — the GPU canvas renders the full frame (video + effect). Use when the GPU pipeline handles all visual content.
- **`alphaMode: 'premultiplied'`** — the GPU canvas is transparent where alpha = 0, letting HTML elements below show through. Use for overlays (particles, path animations) on top of a regular `<video>` element.

## WGSL Full-Screen Triangle

The standard vertex shader for full-screen effects (no vertex buffer needed):

```wgsl
struct Vo { @builtin(position) pos: vec4f, @location(0) uv: vec2f }

@vertex fn vs(@builtin(vertex_index) vi: u32) -> Vo {
  let ps = array<vec2f, 3>(vec2f(-1., -1.), vec2f(3., -1.), vec2f(-1., 3.));
  let ts = array<vec2f, 3>(vec2f(0., 1.), vec2f(2., 1.), vec2f(0., -1.));
  return Vo(vec4f(ps[vi], 0., 1.), ts[vi]);
}
```

Draw with `pass.draw(3)` — one triangle that covers the viewport.

## Rounded-Rect SDF (Liquid Glass Pill)

```wgsl
fn sdf_box(p: vec2f, half_size: vec2f, corner_radius: f32) -> f32 {
  let d = abs(p) - half_size + vec2f(corner_radius);
  return length(max(d, vec2f(0.))) + min(max(d.x, d.y), 0.) - corner_radius;
}
```

Use this to define inside/ring/outside zones for glass effects. Negative values are inside the shape.

## Deterministic Rendering

- No `Math.random()` — use a seeded PRNG.
- Do not use an autonomous `requestAnimationFrame` simulation loop. Render in response to `hf-seek`; HyperFrames owns the paused-presentation heartbeat and may re-present the same time.
- No `performance.now()` for animation time — read `window.__hfTypegpuTime` or `e.detail.time`.
- Register GPU completion with `e.detail.waitUntil(device.queue.onSubmittedWorkDone())` before the event listener returns.
