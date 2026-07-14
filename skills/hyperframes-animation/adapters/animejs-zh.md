---
name: animejs
description: HyperFrames 的 Anime.js 适配器模式。在 HyperFrames 合成中编写 Anime.js 动画或时间轴、在 window.__hfAnime 上注册动画、使 Anime.js 由 seek 驱动且具备确定性时使用；或将 Anime.js 示例转换为可安全渲染的 HyperFrames HTML。
---

# HyperFrames 中的 Anime.js

HyperFrames 可通过其 `animejs` 运行时适配器对 Anime.js 实例进行 seek。合成拥有动画对象；HyperFrames 拥有时钟。

## 约定

- 在合成初始化期间同步创建动画或时间轴。
- 将 `autoplay: false`，以免 Anime.js 使用自己的时钟推进。
- 将每个返回的动画或时间轴注册到 `window.__hfAnime`。
- 使用有限的持续时间和循环次数。
- 避免基于墙钟时间（wall-clock time）、网络状态或未设种随机数而修改 DOM 的回调。

适配器通过 `instance.seek(timeMs)` 对每个已注册实例进行 seek，其中 `timeMs` 是 HyperFrames 的毫秒时间。

## 基本模式

```html
<script src="https://cdn.jsdelivr.net/npm/animejs@4.0.2/lib/anime.iife.min.js"></script>
<script>
  const anim = anime({
    targets: ".mark",
    translateX: 280,
    rotate: "1turn",
    opacity: [0, 1],
    duration: 1200,
    easing: "easeOutExpo",
    autoplay: false,
  });

  window.__hfAnime = window.__hfAnime || [];
  window.__hfAnime.push(anim);
</script>
```

## 时间轴模式

```html
<script>
  const tl = anime.timeline({
    autoplay: false,
    easing: "easeOutCubic",
  });

  tl.add({
    targets: ".title",
    translateY: [40, 0],
    opacity: [0, 1],
    duration: 650,
  }).add(
    {
      targets: ".accent",
      scaleX: [0, 1],
      duration: 450,
    },
    250,
  );

  window.__hfAnime = window.__hfAnime || [];
  window.__hfAnime.push(tl);
</script>
```

## 模块构建

如果你使用 ES 模块构建，适配器不关心实例是如何创建的。它只需要返回的对象暴露 `seek()`、`pause()`，最好还有 `play()`：

```html
<script type="module">
  import { animate } from "https://cdn.jsdelivr.net/npm/animejs/+esm";

  const anim = animate(".chip", {
    x: "18rem",
    duration: 900,
    autoplay: false,
  });

  window.__hfAnime = window.__hfAnime || [];
  window.__hfAnime.push(anim);
</script>
```

## 适用场景

- Anime.js 语法紧凑的小型 SVG 和 DOM 装饰效果。
- 可改为由 seek 驱动（seek-driven）的导入 Anime.js 示例。
- 推送到同一注册表的多个独立微动画。

除非用户明确要求 Anime.js，否则复杂场景编排请使用 GSAP。GSAP 仍是 HyperFrames 的主要创作路径。

## 避免

- 让 `autoplay` 保持 Anime.js 默认值。
- 依赖 `anime.running` 自动发现，而非显式 `window.__hfAnime.push(...)`。
- 无限循环。根据合成时长计算有限的重复次数。
- 在定时器、Promise、事件处理器中，或在异步资源加载后构建动画。

## 验证

编辑使用 Anime.js 的合成后：

```bash
npx hyperframes lint
npx hyperframes validate
```

## 致谢与参考

- HyperFrames 适配器源码：`packages/core/src/runtime/adapters/animejs.ts`。
- Anime.js 关于 `autoplay`、`pause()` 和 `seek()` 的文档：https://animejs.com/documentation/
