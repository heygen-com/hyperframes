---
name: waapi
description: HyperFrames 的 Web Animations API 适配器模式。在编写 element.animate() 动效、Animation currentTime 寻帧、document.getAnimations()、KeyframeEffect 时序、fill 模式，或必须在 HyperFrames 中确定性渲染的原生浏览器动画时使用。
---

# HyperFrames 中的 Web Animations API

HyperFrames 可通过其 `waapi` 运行时适配器对 Web Animations API 动画进行寻帧。当你需要原生浏览器关键帧、由 JavaScript 创建的时间控制，且不想依赖 GSAP 时，WAAPI 非常适用。

## 约定

- 在 composition 初始化期间同步创建动画。
- 使用 `element.animate(...)`，并设置有限的 `duration` 和 `iterations`。
- 使用 `fill: "both"`，以便寻帧后的状态得以保持。
- 创建后暂停动画，或在首次寻帧时让适配器暂停它们。
- 避免使用回调和 promise 来处理渲染关键状态。

适配器会调用 `document.getAnimations()`，将每个动画的 `currentTime` 设为以毫秒为单位的 HyperFrames 时间，然后暂停该动画。

## 基本模式

```html
<div id="orb" class="clip orb" data-start="2" data-duration="3" data-track-index="2"></div>

<script>
  const orb = document.getElementById("orb");
  const animation = orb.animate(
    [
      { transform: "translate3d(-160px, 0, 0) scale(0.8)", opacity: 0 },
      { transform: "translate3d(0, 0, 0) scale(1)", opacity: 1, offset: 0.35 },
      { transform: "translate3d(120px, 0, 0) scale(1.08)", opacity: 1 },
    ],
    {
      duration: 3000,
      delay: 2000,
      easing: "cubic-bezier(0.2, 0, 0, 1)",
      fill: "both",
      iterations: 1,
    },
  );

  animation.pause();
</script>
```

## 交错模式

```js
document.querySelectorAll(".token").forEach((token, index) => {
  const animation = token.animate(
    [
      { transform: "translateY(24px)", opacity: 0 },
      { transform: "translateY(0)", opacity: 1 },
    ],
    {
      duration: 620,
      delay: index * 80,
      easing: "cubic-bezier(0.2, 0, 0, 1)",
      fill: "both",
      iterations: 1,
    },
  );
  animation.pause();
});
```

## 适用场景

- 轻量级 DOM 动效：CSS 关键帧过于死板，又不需要 GSAP。
- 从结构化数据生成动画。
- 可用关键帧、延迟和 offset 表达的简单时间线。

## 避免

- 无限 `iterations`。
- 依赖 `animation.finished` 来修改渲染关键的 DOM。
- 使用 `requestAnimationFrame`、定时器或 `performance.now()` 运行独立时钟。
- 在 transform 和 opacity 已能表达动效时，仍去动画化布局属性。
- 假设 clip 局部起始时间会自动对齐。WAAPI 适配器按文档级动画时间寻帧；请用 `delay` 建模 clip 偏移，或在由 HyperFrames 时序控制可见性的元素上创建动画。

## 验证

编辑 WAAPI composition 后：

```bash
npx hyperframes lint
npx hyperframes validate
```

## 致谢与参考

- HyperFrames 适配器源码：`packages/core/src/runtime/adapters/waapi.ts`。
- MDN Web Animations API 指南：https://developer.mozilla.org/docs/Web/API/Web_Animations_API/Using_the_Web_Animations_API
- MDN `Animation.currentTime`：https://developer.mozilla.org/en-US/docs/Web/API/Animation/currentTime
