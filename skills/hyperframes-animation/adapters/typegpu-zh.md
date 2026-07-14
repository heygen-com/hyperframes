---
name: typegpu
description: HyperFrames 的 TypeGPU 与原生 WebGPU 适配器模式。适用于使用 TypeGPU、原生 WebGPU、WGSL 片段着色器、计算管线、液态玻璃效果、粒子系统，或任何由 navigator.gpu 驱动并响应 HyperFrames hf-seek 事件的 canvas 图层来创作 GPU 渲染合成。
---

# TypeGPU / WebGPU for HyperFrames

HyperFrames 通过 `typegpu` 运行时适配器支持 TypeGPU 和原生 WebGPU。适配器不拥有你的管线。它发布 HyperFrames 时间并派发 seek 事件，让你的合成能够渲染精确的 GPU 帧。

## 约定

- 异步初始化 WebGPU（`await navigator.gpu.requestAdapter()`），但**同步**注册所有 GSAP tween——在任何 `await` 之前。HyperFrames 播放器在页面加载时会立即读取时间轴。
- 根据 HyperFrames 时间渲染，而非 `performance.now()`。
- 监听 `hf-seek` 事件，并在该时间点精确重绘。
- 对 WebGPU 不可用的环境做好防护——适配器不会替你检查。
- 视频渲染时，在提交 GPU 工作后调用 `await device.queue.onSubmittedWorkDone()`，确保帧捕获前 canvas 已刷新。

适配器会设置 `window.__hfTypegpuTime`，并在每次 seek 时派发 `new CustomEvent("hf-seek", { detail: { time } })`。

## 基本模式

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
    window.addEventListener("hf-seek", (e) => render(e.detail.time));
  })();
</script>
```

## 时间轴注册

驱动文本、字幕或 HTML 元素的 GSAP tween 必须**同步**注册——在任何 `await` 之前：

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

## 视频驱动效果（液态玻璃、畸变）

将 `<video>` 用作 GPU 输入纹理：

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

**Render-mode 注意：** 无头 Chrome 可能对 video 元素执行 `copyExternalImageToTexture` 失败。对于生产渲染，请通过 FFmpeg 预提取关键帧为 PNG，并作为图像纹理加载。

## 通过降采样通道实现磨砂模糊

单通道高斯核对于玻璃般的磨砂模糊效果太弱。采用两通道方案：

1. **通道 1 — 降采样：** 将全分辨率纹理渲染到小纹理（1/6 分辨率）。降采样时的双线性过滤会自然地对像素取平均。
2. **通道 2 — 玻璃合成：** 从小纹理采样磨砂内部区域（双线性放大 = 强烈平滑模糊），从全分辨率纹理采样锐利区域和色散折射。

这与 TypeGPU 的 `textureSampleBias` mip 级别方案一致，且无需生成 mipmap。

## 透明与不透明 Canvas

- **`alphaMode: 'opaque'`** — GPU canvas 渲染完整帧（视频 + 效果）。当 GPU 管线处理所有视觉内容时使用。
- **`alphaMode: 'premultiplied'`** — GPU canvas 在 alpha = 0 处透明，让下方 HTML 元素透出。用于常规 `<video>` 元素之上的叠加层（粒子、路径动画等）。

## WGSL 全屏三角形

全屏效果的标准顶点着色器（无需顶点缓冲区）：

```wgsl
struct Vo { @builtin(position) pos: vec4f, @location(0) uv: vec2f }

@vertex fn vs(@builtin(vertex_index) vi: u32) -> Vo {
  let ps = array<vec2f, 3>(vec2f(-1., -1.), vec2f(3., -1.), vec2f(-1., 3.));
  let ts = array<vec2f, 3>(vec2f(0., 1.), vec2f(2., 1.), vec2f(0., -1.));
  return Vo(vec4f(ps[vi], 0., 1.), ts[vi]);
}
```

使用 `pass.draw(3)` 绘制——一个覆盖整个视口的三角形。

## 圆角矩形 SDF（液态玻璃胶囊）

```wgsl
fn sdf_box(p: vec2f, half_size: vec2f, corner_radius: f32) -> f32 {
  let d = abs(p) - half_size + vec2f(corner_radius);
  return length(max(d, vec2f(0.))) + min(max(d.x, d.y), 0.) - corner_radius;
}
```

用于定义玻璃效果的内部/环形/外部区域。负值表示在形状内部。

## 确定性渲染

- 不使用 `Math.random()`——使用带种子的伪随机数生成器（PRNG）。
- 不使用 `requestAnimationFrame` 作为渲染循环——仅在响应 `hf-seek` 时渲染。
- 不使用 `performance.now()` 作为动画时间——读取 `window.__hfTypegpuTime` 或 `e.detail.time`。
- GPU 提交后，调用 `await device.queue.onSubmittedWorkDone()` 以支持 render-mode 帧捕获。
