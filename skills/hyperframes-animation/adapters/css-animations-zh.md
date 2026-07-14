---
name: css-animations
description: HyperFrames 的 CSS 动画适配器模式。适用于编写 CSS 关键帧、基于 animation-delay 的时序、animation-fill-mode、animation-play-state，或 HyperFrames 在预览和渲染期间需要确定性寻址的纯 CSS 动效。
---

# HyperFrames 的 CSS 动画

HyperFrames 可通过其 `css` 运行时适配器寻址 CSS 关键帧动画。适用于简单的重复图案、背景运动、闪光、发光、遮罩以及非序列化的装饰效果。

对于场景编排，通常使用 GSAP 更清晰。CSS 动画最适合属于单个元素且持续时间固定的动效。

## 约定

- 在运行时初始化完成之前，将动画元素放入 DOM。
- 为带时序的元素设置 `data-start` 值，使本地动画时间与 clip 对齐。
- 使用有限的 `animation-duration` 和 `animation-iteration-count`，因为在没有 WAAPI 支持的 CSS 动画环境中，负延迟回退无法表示无界持续时间。
- 优先使用 `animation-fill-mode: both`，以便寻址后的状态在活动动效前后保持。
- 避免依赖挂钟的 JavaScript、悬停触发状态，以及依赖用户事件的类切换。

适配器会查找具有计算后 `animation-name` 的元素，在可用时寻址其浏览器的 `Animation` 句柄，否则回退为通过负 `animation-delay` 暂停。

## 基础模式

```html
<div
  id="pulse-ring"
  class="clip pulse-ring"
  data-start="0"
  data-duration="4"
  data-track-index="2"
></div>

<style>
  .pulse-ring {
    width: 280px;
    height: 280px;
    border: 4px solid rgba(255, 255, 255, 0.7);
    border-radius: 50%;
    animation-name: pulse-ring;
    animation-duration: 1200ms;
    animation-timing-function: cubic-bezier(0.2, 0, 0, 1);
    animation-iteration-count: 3;
    animation-fill-mode: both;
  }

  @keyframes pulse-ring {
    from {
      opacity: 0;
      transform: scale(0.82);
    }
    35% {
      opacity: 1;
    }
    to {
      opacity: 0;
      transform: scale(1.18);
    }
  }
</style>
```

## 交错模式

使用 CSS 自定义属性，避免重复关键帧：

```html
<div class="clip dots" data-start="1" data-duration="3" data-track-index="3">
  <span style="--i: 0"></span>
  <span style="--i: 1"></span>
  <span style="--i: 2"></span>
</div>

<style>
  .dots span {
    display: inline-block;
    width: 18px;
    height: 18px;
    margin-right: 10px;
    border-radius: 50%;
    background: currentColor;
    animation: dot-pop 900ms ease-out both;
    animation-delay: calc(var(--i) * 120ms);
  }

  @keyframes dot-pop {
    from {
      opacity: 0;
      transform: translateY(18px) scale(0.75);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
</style>
```

## 适用场景

- 已知重复次数的装饰性循环。
- 遮罩、发光、闪光、颗粒和微妙视差层。
- 完整 JS 时间线过于冗杂的简单单元素入场。

## 避免使用

- 无限循环的 CSS 动画，除非你已验证浏览器暴露了可寻址的 WAAPI 支持的 CSS 动画句柄。优先使用覆盖可见时长的有限迭代次数。
- 在 transform 可用时，避免对 `top`、`left`、`width` 或 `height` 等布局属性做动画。
- 依赖 hover、focus、scroll 或媒体查询来触发渲染关键动效。
- 在启动后更改动画类，除非有另一个确定性时间线控制该变更。

## 验证

编辑 CSS 动画合成后：

```bash
npx hyperframes lint
npx hyperframes validate
```

## 致谢与参考

- HyperFrames 适配器源码：`packages/core/src/runtime/adapters/css.ts`。
- MDN CSS 动画文档：https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/animation
- MDN `animation-fill-mode`：https://developer.mozilla.org/en-US/docs/Web/CSS/animation-fill-mode
