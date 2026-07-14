---
name: three
description: 适用于 HyperFrames 的 Three.js 与 WebGL 适配器模式。在创建确定性 Three.js 场景、WebGL 画布层、AnimationMixer 时间轴、相机动画、着色器驱动的视觉效果，或响应 HyperFrames hf-seek 事件的画布渲染时使用。
---

# HyperFrames 中的 Three.js

HyperFrames 通过其 `three` 运行时适配器支持 Three.js。该适配器不拥有你的场景。它会发布 HyperFrames 时间并派发 seek 事件，以便你的合成能够渲染精确帧。

## 约定

- 尽可能同步创建场景、相机、渲染器、材质和资源。
- 根据 HyperFrames 时间渲染，而非墙钟时间（wall-clock time）。
- 监听 `hf-seek` 事件并按该时间精确渲染。
- 在渲染关键的 seek 操作之前加载模型、纹理和 HDRI。不要在 seek 时获取它们。
- 避免将 `requestAnimationFrame` 或 `renderer.setAnimationLoop` 作为渲染关键运动的唯一依据。

适配器会设置 `window.__hfThreeTime`，并在每次 seek 时派发 `new CustomEvent("hf-seek", { detail: { time } })`。

## 基础模式

```html
<canvas id="three-layer"></canvas>
<script type="module">
  import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.181.2/+esm";

  const canvas = document.getElementById("three-layer");
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  // Match these to your composition's frame size.
  renderer.setSize(1920, 1080, false);
  renderer.setPixelRatio(1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1920 / 1080, 0.1, 100);
  camera.position.set(0, 0, 6);

  const mesh = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.4, 4),
    new THREE.MeshStandardMaterial({ color: 0x64d2ff, roughness: 0.38 }),
  );
  scene.add(mesh);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 2));

  function renderAt(time) {
    mesh.rotation.y = time * 0.7;
    mesh.rotation.x = Math.sin(time * 0.6) * 0.16;
    renderer.render(scene, camera);
  }

  window.addEventListener("hf-seek", (event) => {
    renderAt(event.detail.time);
  });

  renderAt(window.__hfThreeTime || 0);
</script>
```

```css
#three-layer {
  width: 100%;
  height: 100%;
  display: block;
}
```

## AnimationMixer 模式

对于 GLTF 或已创作的片段动画，直接 seek 混合器：

```js
function renderAt(time) {
  mixer.setTime(time);
  renderer.render(scene, camera);
}
```

如果存在多个混合器，使用相同的 `time` seek 所有混合器。

## 适用场景

- 确定性 3D 对象、产品旋转、使用种子数据的粒子，以及着色器板。
- 由 `time` 推导的相机运动。
- GLTF 动画片段（当资源为本地且在验证完成前已加载时）。

## 避免

- 使用 `Date.now()`、`performance.now()` 或时钟增量来更新场景状态。
- 将渲染关键工作留在自由运行的动画循环中。
- 在渲染时加载远程模型或纹理。
- 依赖设备像素比的输出。为视频渲染固定渲染器尺寸和像素比。
- 依赖前一帧历史的后处理通道，除非你能从时间重建状态。

## 验证

编辑 Three.js 合成后：

```bash
npx hyperframes lint
npx hyperframes validate
```

## 致谢与参考

- HyperFrames 适配器源码：`packages/core/src/runtime/adapters/three.ts`。
- Three.js `WebGLRenderer` 文档：https://threejs.org/docs/pages/WebGLRenderer.html
- Three.js `AnimationMixer.setTime()` 文档：https://threejs.org/docs/pages/AnimationMixer.html
