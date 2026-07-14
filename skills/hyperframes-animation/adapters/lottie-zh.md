---
name: lottie
description: HyperFrames 的 Lottie 与 dotLottie 适配器模式。适用于嵌入 lottie-web JSON 动画、.lottie 文件、@lottiefiles/dotlottie-web 播放器，在 window.__hfLottie 上注册实例，或使 After Effects 导出在 HyperFrames 中具有确定性。
---

# HyperFrames 中的 Lottie

HyperFrames 可通过其 `lottie` 运行时适配器对 `lottie-web` 和 dotLottie 播放器进行 seek。Lottie 非常适合，因为动画时间轴已编码在资源中；HyperFrames 只需一个可以 seek 的播放器对象。

## 约定

- 从本地项目文件加载资源，通常放在 `assets/` 下。
- 设置 `autoplay: false`。
- 除非用户明确需要循环，否则优先使用 `loop: false`。
- 将每个返回的动画或播放器注册到 `window.__hfLottie`。
- 用 CSS 保持 Lottie 容器尺寸稳定。

适配器通过 `goToAndStop(timeMs, false)` seek `lottie-web`，并根据播放器类型使用帧或百分比 API seek dotLottie。

## lottie-web 模式

```html
<div id="logo-lottie" class="lottie-layer"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/bodymovin/5.12.2/lottie.min.js"></script>
<script>
  const anim = lottie.loadAnimation({
    container: document.getElementById("logo-lottie"),
    renderer: "svg",
    loop: false,
    autoplay: false,
    path: "assets/logo-reveal.json",
  });

  window.__hfLottie = window.__hfLottie || [];
  window.__hfLottie.push(anim);
</script>
```

```css
.lottie-layer {
  width: 100%;
  height: 100%;
}
```

## dotLottie 模式

```html
<canvas id="product-lottie" class="lottie-canvas"></canvas>
<script src="https://unpkg.com/@lottiefiles/dotlottie-web"></script>
<script>
  const player = new DotLottie({
    canvas: document.getElementById("product-lottie"),
    src: "assets/product-flow.lottie",
    autoplay: false,
    loop: false,
  });

  window.__hfLottie = window.__hfLottie || [];
  window.__hfLottie.push(player);
</script>
```

```css
.lottie-canvas {
  width: 100%;
  height: 100%;
  display: block;
}
```

## 多个动画

将每个播放器推入同一注册表：

```js
window.__hfLottie = window.__hfLottie || [];
window.__hfLottie.push(backgroundAnim);
window.__hfLottie.push(iconAnim);
window.__hfLottie.push(confettiAnim);
```

HyperFrames 会将它们全部 seek 到同一合成时间。

## 适用场景

- 已在 lottie-web 中验证可正确渲染的 After Effects 导出。
- Logo 揭示、图标循环、装饰性点缀和产品 UI 动效。
- 将 Remotion Lottie 用法转换为纯 HyperFrames HTML。

## 应避免

- 在渲染时依赖远程 `path` URL。
- 使用 `play()` 开始播放。
- 假设不支持的 After Effects 效果能在导出后保留。请先在浏览器中测试 JSON 或 `.lottie` 文件。
- 异步加载播放器，并在 HyperFrames 验证已检查页面之后才注册。

## 验证

编辑 Lottie 合成后：

```bash
npx hyperframes lint
npx hyperframes validate
```

## 致谢与参考

- HyperFrames 适配器源码：`packages/core/src/runtime/adapters/lottie.ts`。
- lottie-web by Airbnb: https://github.com/airbnb/lottie-web
- lottie-web `loadAnimation` options: https://github.com/airbnb/lottie-web/wiki/loadAnimation-options
- dotLottie web player methods by LottieFiles: https://developers.lottiefiles.com/docs/dotlottie-player/dotlottie-web/methods
