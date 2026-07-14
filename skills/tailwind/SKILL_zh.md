---
name: tailwind
description: HyperFrames 合成项目中 Tailwind CSS v4.2 浏览器运行时的使用模式。适用于通过 `hyperframes init --tailwind` 创建或编辑的项目、在合成 HTML 中编写 Tailwind 工具类、添加 CSS-first 的 Tailwind v4 主题令牌、调试 v3 与 v4 语法差异，或决定何时将 Tailwind 编译为 CSS 而非使用浏览器运行时。
---

# HyperFrames 中的 Tailwind CSS

HyperFrames 的 `init --tailwind` 使用固定版本的 `@tailwindcss/browser@4.2.4` 浏览器运行时。请将其视为 Tailwind v4，而非 v3。

本技能面向 CLI 生成的合成 HTML，不适用于 `packages/studio`——后者内部仍使用 Tailwind v3，配合 `tailwind.config.js`、PostCSS 和 `@tailwind` 指令。

## 何时使用

- 用户要求在 HyperFrames 合成中使用 Tailwind。
- 项目通过 `hyperframes init --tailwind` 创建。
- 在 `index.html` 中看到 `window.__tailwindReady`。
- 需要工具类、CSS-first 主题令牌、自定义工具类，或 v3 到 v4 的迁移指导。
- 渲染缺少样式，且项目依赖浏览器运行时。

## 版本约定

- 固定运行时：`@tailwindcss/browser@4.2.4`。
- 浏览器运行时脚本由 CLI 注入。不要用 `cdn.tailwindcss.com` 替换它。
- HyperFrames 在帧捕获开始前会等待 `window.__tailwindReady`。
- 就绪垫片（readiness shim）必须保持确定性：不使用渲染循环轮询 API、不使用时钟驱动的重试、除固定的 Tailwind 运行时脚本外不进行运行时网络请求。
- 对于离线、受限或需要生产稳定性的渲染，应将 Tailwind 编译为 CSS 并直接引入样式表，而非依赖浏览器运行时。

## v4 规则

Tailwind v4 采用 CSS-first 方式：

```html
<style type="text/tailwindcss">
  @theme {
    --color-brand: oklch(0.68 0.2 252);
    --font-display: "Inter", sans-serif;
  }

  @utility headline-balance {
    text-wrap: balance;
    letter-spacing: 0;
  }
</style>
```

在浏览器运行时合成中避免 v3 配置模式：

```css
/* Do not use these in Tailwind v4 browser-runtime compositions. */
@tailwind base;
@tailwind components;
@tailwind utilities;
```

不要仅为在 v4 浏览器运行时合成中定义颜色、字体、间距或工具类而添加 `tailwind.config.js`。请在 `text/tailwindcss` 样式块中使用 `@theme` 和 `@utility`。

若编译版 v4 构建确实需要现有 JavaScript 配置，请通过 CSS 中的 `@config` 显式加载，并在浏览器中验证。不要假设 v4 会自动检测 v3 配置文件。

## HyperFrames 合成模式

让 Tailwind 负责静态布局与视觉样式，将动画时序交给 GSAP 或其他可寻址（seekable）适配器。

```html
<section
  class="clip absolute inset-0 grid place-items-center bg-zinc-950 text-white"
  data-start="0"
  data-duration="5"
  data-track-index="1"
>
  <div class="w-[1280px] max-w-[82vw] text-center">
    <p class="mb-6 text-xl font-medium uppercase tracking-[0.18em] text-cyan-300">
      Render-ready Tailwind
    </p>
    <h1 class="text-7xl font-black leading-none text-balance">
      Utility classes, deterministic frames.
    </h1>
  </div>
</section>
```

对于重复项，优先使用类列表配合 CSS 自定义属性，而非动态生成类名：

```html
<span class="inline-block translate-y-[calc(var(--i)*6px)] opacity-80" style="--i: 0"></span>
<span class="inline-block translate-y-[calc(var(--i)*6px)] opacity-80" style="--i: 1"></span>
<span class="inline-block translate-y-[calc(var(--i)*6px)] opacity-80" style="--i: 2"></span>
```

## 动态类名安全

Tailwind 浏览器运行时会扫描当前文档，并为它能看到的类名生成 CSS。不要在寻址时刻才拼装渲染关键类名：

```js
// Risky: Tailwind may not see every generated class before capture.
element.className = `bg-${color}-500`;
```

请在 HTML、data 属性或显式 CSS 中使用完整类名：

```html
<div data-tone="blue" class="bg-blue-500 data-[tone=rose]:bg-rose-500"></div>
```

若无法避免生成类名，请确保完整类名令牌在验证前已出现在 `text/tailwindcss` 块中。

## 视频相关约束

- 使用稳定尺寸：`w-[...]`、`h-[...]`、`aspect-video`、`grid`、`flex`，以及固定内边距来布局视频画面。
- 动画属性优先使用 transform 和 opacity。
- 除非可寻址运行时掌控状态，否则不要在渲染关键时序中使用 Tailwind 过渡。
- 对必须确定性渲染的内容，避免 hover、focus、scroll、viewport 或 pointer 变体。
- 使用显式边框颜色。Tailwind v4 相对 v3 改变了默认边框行为，因此 `border border-white/20` 比单独的 `border` 更安全。
- 使用 v4 工具类名：在适用处使用 `shadow-xs`、`rounded-xs`、`outline-hidden`、`shrink-*` 和 `grow-*` 等替代名称。
- 若输出需要兼容较旧浏览器，使用现代 CSS 工具类时要谨慎。Tailwind v4 面向现代浏览器。

## 验证

编辑启用 Tailwind 的合成后：

```bash
npx hyperframes lint
npx hyperframes validate
npx hyperframes inspect
```

渲染验证：

```bash
npx hyperframes render . --workers 1 --quality draft --output tailwind-proof.mp4
```

验证流程应在第 0 帧不出现样式缺失闪烁。若预览有样式但渲染没有，请检查 `window.__tailwindReady` 是否存在，并在捕获前已 resolve。

## 快速调试清单

1. 确认项目通过 `hyperframes init --tailwind` 脚手架创建。
2. 确认脚本指向 `@tailwindcss/browser@4.2.4`。
3. 确认存在 `window.__tailwindReady`。
4. 将 v3 的 `@tailwind` 指令替换为 v4 浏览器运行时 CSS。
5. 将 `tailwind.config.js` 中的自定义令牌迁移到 `@theme`。
6. 将动态拼装的类名替换为完整的静态令牌。
7. 运行 `npx hyperframes validate` 并渲染一段短证明视频。

## 致谢与参考

- Tailwind CSS 官方 v4 安装、升级与兼容性文档：https://tailwindcss.com/docs
- Tailwind CSS v4 发布说明：https://tailwindcss.com/blog/tailwindcss-v4
- 社区 Tailwind 技能曾用于审阅 v4 常见陷阱与技能结构，但本技能将持久约定保留在仓库内，并针对 HyperFrames 定制。
