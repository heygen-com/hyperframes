---
name: hyperframes
description: 在 HyperFrames HTML 中创建视频合成、动画、标题卡、叠层、字幕、配音、音频反应式视觉效果和场景转场。当需要构建任何基于 HTML 的视频内容、添加与音频同步的字幕、生成文本转语音（TTS）旁白、创建音频反应式动画（节拍同步、发光、由音乐驱动的脉冲）、添加动画文本高亮（标记扫光、手绘圆圈、爆发线、涂鸦、素描效果），或添加场景之间的转场（交叉淡化、擦除、揭示、着色器转场）时使用。涵盖合成编写、时间线、媒体和完整视频制作流程。开发循环 CLI 命令（init、lint、inspect、preview、render）请参阅 hyperframes-cli 技能；资源预处理命令（tts、transcribe、remove-background）请参阅 hyperframes-media 技能。
---

# HyperFrames

HTML 是视频的唯一事实来源。合成是一个带有 `data-*` 属性用于时间控制的 HTML 文件，使用 GSAP 时间线实现动画，使用 CSS 控制外观。框架负责剪辑可见性、媒体播放和时间线同步。

## 方法

### 探索（仅适用于探索性需求）

对于开放式需求（「帮我做一个产品发布视频」「为我们的品牌创作一些内容」），在用户尚未确定方向时，先理解意图再选择配色：

- **受众** — 谁会观看？开发者？高管？普通消费者？
- **平台** — 在哪里播放？社交媒体（15 秒）、网站首屏、产品演示、内部使用？
- **优先级** — 什么最重要？动效质量？内容准确性？品牌一致性？速度？
- **变体** — 用户想要多个方案，还是只要一个最佳方案？

对于具体需求（「添加标题卡」「修复第 3 场景的时间线」），跳过探索阶段。

对于探索性需求，可考虑提供 2–3 个有实质差异的变体 — 不仅是换色，而是不同的节奏、能量层级或结构方式。一个稳妥/符合预期，一个更大胆。这不是强制要求 — 只是在合适时可用的工具。

### 步骤 1：设计系统

如果项目中已有设计规范，请先阅读。按以下优先级查找：`frame.md` → `design.md` → `DESIGN.md`（`design.md` 和 `DESIGN.md` 在 Linux 上是不同文件 — 两种大小写都要检查；`frame.md` 始终为小写，没有 `FRAME.md` 变体）。`frame.md` 是视频/hyperframes 项目的首选规范，若存在多个则以其为准；格式与 `design.md` 相同。它是品牌色、字体和约束的唯一事实来源。使用其精确值 — 不要自行发明颜色或替换字体。任何格式均可（YAML frontmatter、散文、表格 — 只需提取数值）。

如果规范中指定的字体在本地找不到（`fonts/` 目录中没有 `.woff2` 文件，也不是内置字体），在编写 HTML 前警告用户：「规范指定了 [字体名]，但未找到字体文件。请将 .woff2 文件添加到 `fonts/`，否则我将回退到 [最接近的内置替代字体]。」

如果不存在 `frame.md` 或 `design.md`，向用户提供选择：

1. **用户指定了风格或情绪？** → 阅读 [visual-styles.md](./visual-styles.md) 了解 8 个命名预设，选择最接近的匹配。
2. **想可视化浏览选项？** → 运行设计选择器：阅读 [references/design-picker.md](references/design-picker.md) 了解完整流程。这会提供一个可视化选择页面。用户在浏览器中配置情绪、调色板、字体和动效，然后复制生成的 design.md 并粘贴回对话。
3. **想跳过并快速开始？** → 询问：情绪、浅色或深色、是否有品牌色/字体？然后从 [house-style.md](./house-style.md) 中选择一个调色板。

**设计规范定义品牌，不定义视频合成规则。** 后者来自 [references/video-composition.md](references/video-composition.md) 和 [house-style.md](./house-style.md)。以适合视频的尺度使用品牌色 — 不要用网页 UI 的不透明度。

### 步骤 2：提示词扩展

每个合成都应执行此步骤（单场景作品和琐碎编辑除外）。此步骤将用户意图与设计规范（`frame.md` 或 `design.md`）和 `house-style.md` 对齐，并生成一致的中间产物，供所有下游代理以相同方式读取。

阅读 [references/prompt-expansion.md](references/prompt-expansion.md) 了解完整流程和输出格式。

### 步骤 3：规划

在编写 HTML 之前，从高层思考：

1. **内容** — 观众应体验什么？识别叙事弧线、关键时刻和情感节拍。
2. **结构** — 有多少个合成，哪些是子合成 vs 内联，各轨道承载什么（视频、音频、叠层、字幕）。
3. **节奏** — 在实现前声明场景节奏。哪些场景是快切，哪些是停留，着色器在哪里落地，能量在哪里达到峰值。命名模式：fast-fast-SLOW-fast-SHADER-hold。阅读 [references/beat-direction.md](references/beat-direction.md) 了解节奏模板。
4. **时间线** — 哪些剪辑决定时长，转场在哪里落地，节奏如何。
5. **布局** — 先构建终态。见下方「先布局后动画」。
6. **动画** — 然后按以下规则添加动效。

**构建用户所要求的内容。** 「做一个标题卡」不等于「标题卡 + 3 个辅助场景 + 环境音乐 + 字幕」。每个场景、每个元素、每个补间都应有其存在的理由。如果额外场景或元素确实能提升作品，应提出建议 — 不要直接添加。

对于小改动（修复颜色、调整时间线、添加一个元素），直接跳到规则部分。

<HARD-GATE>
在编写任何合成 HTML 之前 — 确认你已从步骤 1 获得视觉识别。如果你伸手去拿 `#333`、`#3b82f6` 或 `Roboto`，说明你跳过了这一步。
</HARD-GATE>

## 先布局后动画

将每个元素定位在其**最可见时刻**应在的位置 — 即完全进入、位置正确、尚未退出的那一帧。先以静态 HTML+CSS 编写。暂不使用 GSAP。

**为什么重要：** 如果将元素定位在动画起始状态（屏幕外、缩放为 0、透明度 0）再补间到你认为应落位的位置，你就是在猜测最终布局。重叠问题在视频渲染前不可见。先构建终态，可以在添加任何动效之前发现并修复布局问题。

### 流程

1. **识别每个场景的英雄帧** — 最多元素同时可见的时刻。这就是你要构建的布局。
2. **为该帧编写静态 CSS**。`.scene-content` 容器必须使用 `width: 100%; height: 100%; padding: Npx;` 填满整个场景，配合 `display: flex; flex-direction: column; gap: Npx; box-sizing: border-box`。用 padding 将内容向内推 — 绝不要在内容容器上使用 `position: absolute; top: Npx`。绝对定位的内容容器在内容高于剩余空间时会溢出。`position: absolute` 仅保留给装饰元素。
3. **用 `gsap.from()` 添加入场** — 从屏幕外/不可见动画到 CSS 位置。CSS 位置是 ground truth；补间描述到达那里的旅程。（在通过 `data-composition-src` 加载的子合成中，优先使用 `gsap.fromTo()` — 见 [references/motion-principles.md](references/motion-principles.md) 中的 load-bearing GSAP 规则。）
4. **用 `gsap.to()` 添加退场** — 从 CSS 位置动画到屏幕外/不可见。

### 示例

```css
/* scene-content fills the scene, padding positions content */
.scene-content {
  display: flex;
  flex-direction: column;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 120px 160px;
  gap: 24px;
  box-sizing: border-box;
}
.title {
  font-size: 120px;
}
.subtitle {
  font-size: 42px;
}
/* Container fills any scene size (1920x1080, 1080x1920, etc).
   Padding positions content. Flex + gap handles spacing. */
```

**错误 — 硬编码尺寸和绝对定位：**

```css
.scene-content {
  position: absolute;
  top: 200px;
  left: 160px;
  width: 1920px;
  height: 1080px;
  display: flex; /* ... */
}
```

```js
// Step 3: Animate INTO those positions
tl.from(".title", { y: 60, opacity: 0, duration: 0.6, ease: "power3.out" }, 0);
tl.from(".subtitle", { y: 40, opacity: 0, duration: 0.5, ease: "power3.out" }, 0.2);
tl.from(".logo", { scale: 0.8, opacity: 0, duration: 0.4, ease: "power2.out" }, 0.3);

// Step 4: Animate OUT from those positions
tl.to(".title", { y: -40, opacity: 0, duration: 0.4, ease: "power2.in" }, 3);
tl.to(".subtitle", { y: -30, opacity: 0, duration: 0.3, ease: "power2.in" }, 3.1);
tl.to(".logo", { scale: 0.9, opacity: 0, duration: 0.3, ease: "power2.in" }, 3.2);
```

### 元素跨时间共享空间时

如果元素 A 在元素 B 进入同一区域之前退场，两者在各自英雄帧中都应有正确的 CSS 位置。时间线顺序保证它们不会视觉上共存 — 但如果跳过布局步骤，你不会发现因时间线错误导致的意外重叠。

### 什么算有意重叠

层叠效果（文字背后的发光、阴影元素、背景图案）和 z 轴堆叠设计（卡片堆叠、深度层）是有意的。布局步骤是为了捕捉**无意**重叠 — 两个标题叠在一起、数据覆盖标签、内容溢出画框。

## 数据属性

### 所有剪辑

| Attribute          | Required                          | Values                                                 |
| ------------------ | --------------------------------- | ------------------------------------------------------ |
| `id`               | 是                                | 唯一标识符                                             |
| `data-start`       | 是                                | 秒数或剪辑 ID 引用（`"el-1"`、`"intro + 2"`）           |
| `data-duration`    | img/div/合成 必填                   | 秒数。视频/音频默认为媒体时长。                        |
| `data-track-index` | 是                                | 整数。同轨道剪辑不能重叠。                             |
| `data-media-start` | 否                                | 源媒体的裁剪偏移（秒）                                 |
| `data-volume`      | 否                                | 0-1（默认 1）                                          |

`data-track-index` **不**影响视觉层叠 — 使用 CSS `z-index`。

### 合成剪辑

| Attribute                    | Required | Values                                                            |
| ---------------------------- | -------- | ----------------------------------------------------------------- |
| `data-composition-id`        | 是       | 唯一合成 ID                                                       |
| `data-start`                 | 是       | 开始时间（根合成：使用 `"0"`）                                    |
| `data-duration`              | 是       | 优先于 GSAP 时间线时长                                            |
| `data-width` / `data-height` | 是       | 像素尺寸（1920x1080 或 1080x1920）                                |
| `data-composition-src`       | 否       | 外部 HTML 文件路径                                                |
| `data-variable-values`       | 否       | 子合成宿主上每个实例的变量覆盖 JSON 对象                          |

在根 `<html>` 元素上：

| Attribute                    | Required | Values                                                                                                                         |
| ---------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `data-composition-variables` | 否       | 声明变量的 JSON 数组（id/type/label/default）— 驱动 Studio 编辑 UI 并为 `getVariables()` 提供默认值                            |

## 合成结构

通过 `data-composition-src` 加载的子合成使用 `<template>` 包装器。**独立合成（主 index.html）不使用 `<template>`** — 它们将 `data-composition-id` div 直接放在 `<body>` 中。在独立文件上使用 `<template>` 会隐藏所有内容并破坏渲染。

子合成结构：

```html
<template id="my-comp-template">
  <div data-composition-id="my-comp" data-width="1920" data-height="1080">
    <!-- content -->
    <style>
      [data-composition-id="my-comp"] {
        /* scoped styles */
      }
    </style>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      // tweens...
      window.__timelines["my-comp"] = tl;
    </script>
  </div>
</template>
```

在根中加载：`<div id="el-1" data-composition-id="my-comp" data-composition-src="compositions/my-comp.html" data-start="0" data-duration="10" data-track-index="1"></div>`

## 变量（参数化合成）

以不同内容渲染同一合成 — 标题、主题色、价格、字幕 — 无需编辑源 HTML。

**三步模式：**

1. **声明** — 在合成的 `<html>` 根元素上用 `data-composition-variables` 声明变量。每项需要 `id`、`type`（`string`、`number`、`color`、`boolean`、`enum` 之一）、`label` 和 `default`。enum 类型还需要 `options: [{value, label}, ...]`。
2. **读取** — 在合成脚本内用 `window.__hyperframes.getVariables()` 读取解析后的值。返回声明默认值 + 每实例覆盖 + CLI 覆盖的合并结果。
3. **覆盖** — 渲染时用 `npx hyperframes render --variables '{...}'`（顶层）或在宿主元素上用 `data-variable-values='{...}'`（子合成的每实例覆盖）。

```html
<!doctype html>
<html
  data-composition-variables='[
  {"id":"title","type":"string","label":"Title","default":"Hello"},
  {"id":"theme","type":"enum","label":"Theme","default":"light","options":[
    {"value":"light","label":"Light"},
    {"value":"dark","label":"Dark"}
  ]}
]'
>
  <body>
    <div data-composition-id="root" data-width="1920" data-height="1080">
      <h1 id="hero" class="clip" data-start="0" data-duration="3"></h1>
      <script>
        const { title, theme } = window.__hyperframes.getVariables();
        document.getElementById("hero").textContent = title;
        document.body.dataset.theme = theme;
      </script>
    </div>
  </body>
</html>
```

```bash
# Dev preview uses declared defaults
npx hyperframes preview

# Render with overrides
npx hyperframes render --variables '{"title":"Q4 Report","theme":"dark"}' --output q4.mp4

# Or from a JSON file
npx hyperframes render --variables-file ./vars.json
```

**子合成每实例值：** 通过 `data-composition-src` 加载的子合成内同样适用 `getVariables()`。每个宿主元素传递自己的值：

```html
<div
  data-composition-id="card-pro"
  data-composition-src="compositions/card.html"
  data-variable-values='{"title":"Pro","price":"$29"}'
></div>
<div
  data-composition-id="card-enterprise"
  data-composition-src="compositions/card.html"
  data-variable-values='{"title":"Enterprise","price":"Custom"}'
></div>
```

运行时将每个宿主的 `data-variable-values` 按实例叠加在子合成声明的默认值之上，因此同一源文件可以嵌入多次并携带不同内容。

**经验法则：**

- 为每个声明的变量提供合理的 `default`。开发预览使用默认值 — 没有它们，合成在提供 `--variables` 之前无法正确渲染。
- 在脚本顶部读取变量一次（`const { title } = ...`），不要在帧循环或事件处理器内读取 — `getVariables()` 每次调用都会分配新对象。
- 在 CI 中使用 `--strict-variables` 以快速失败于未声明的键或类型不匹配。
- 变量类型在渲染时验证。`string`、`number`、`boolean` 和 `color`（十六进制字符串）检查 `typeof`；`enum` 检查值是否在声明的 `options` 中。

## 视频和音频

视频必须为 `muted playsinline`。音频始终是独立的 `<audio>` 元素：

```html
<video
  id="el-v"
  data-start="0"
  data-duration="30"
  data-track-index="0"
  src="video.mp4"
  muted
  playsinline
></video>
<audio
  id="el-a"
  data-start="0"
  data-duration="30"
  data-track-index="2"
  src="video.mp4"
  data-volume="1"
></audio>
```

## 时间线约定

- 所有时间线以 `{ paused: true }` 启动 — 播放器控制播放
- 注册每个时间线：`window.__timelines["<composition-id>"] = tl`
- 框架自动嵌套子时间线 — 不要手动添加
- 时长来自 `data-duration`，而非 GSAP 时间线长度
- 不要创建空补间来设置时长

## 规则（不可协商）

**确定性：** 不使用 `Math.random()`、`Date.now()` 或基于时间的逻辑。如需伪随机值，使用带种子的 PRNG（例如 mulberry32）。

**GSAP：** 仅动画视觉属性（`opacity`、`x`、`y`、`scale`、`rotation`、`color`、`backgroundColor`、`borderRadius`、transform）。不要动画 `visibility`、`display`，或调用 `video.play()`/`audio.play()`。

**动画冲突：** 不要从多个时间线同时对同一元素的同一属性做动画。

**禁止 `repeat: -1`：** 无限重复时间线会破坏捕获引擎。根据合成时长计算精确重复次数：`repeat: Math.ceil(duration / cycleDuration) - 1`。

**同步时间线构建：** 不要在 `async`/`await`、`setTimeout` 或 Promise 内构建时间线。捕获引擎在页面加载后同步读取 `window.__timelines`。字体由编译器嵌入，立即可用 — 无需等待字体加载。

**禁止：**

1. 忘记 `window.__timelines` 注册
2. 用视频播放音频 — 始终使用静音视频 + 独立 `<audio>`
3. 将视频嵌套在定时 div 内 — 使用非定时包装器
4. 使用 `data-layer`（应使用 `data-track-index`）或 `data-end`（应使用 `data-duration`）
5. 动画视频元素尺寸 — 动画包装 div
6. 调用媒体的 play/pause/seek — 框架拥有播放控制权
7. 创建没有 `data-composition-id` 的顶层容器
8. 在任何时间线或补间上使用 `repeat: -1` — 始终使用有限重复
9. 异步构建时间线（在 `async`、`setTimeout`、`Promise` 内）
10. 对后续场景的剪辑元素使用 `gsap.set()` — 它们在页面加载时不存在于 DOM 中。改用时间线内的 `tl.set(selector, vars, timePosition)`，时间位置在剪辑的 `data-start` 时刻或之后。
11. 在内容文本中使用 `<br>` — 强制换行不考虑实际渲染字体宽度。自然换行的文本 + `<br>` 会产生多余的换行，导致重叠。通过 `max-width` 让文本自然换行。例外：每个词刻意独占一行的短展示标题（例如 130px 的 "THE\nIMMORTAL\nGAME"）。

## 场景转场（不可协商）

每个多场景合成必须遵循以下所有规则。违反任何一条即为损坏的合成。

1. **场景之间始终使用转场。** 禁止硬切。没有例外。
2. **每个场景始终使用入场动画。** 每个元素通过 `gsap.from()` 动画进入。任何元素不得完全成型地出现。如果一个场景有 5 个元素，就需要 5 个入场补间。
3. **禁止使用退场动画**，最终场景除外。即：在转场触发之前，禁止 `gsap.to()` 将 opacity 动画到 0、y 移出屏幕、scale 到 0，或任何其他「退出」动画。转场就是退场。转场开始时，退场场景的内容必须完全可见。
4. **仅最终场景：** 最后一个场景可以让元素淡出（例如淡出到黑）。这是唯一允许 `gsap.to(..., { opacity: 0 })` 的场景。

**错误 — 转场前的退场动画：**

```js
// BANNED — this empties the scene before the transition can use it
tl.to("#s1-title", { opacity: 0, y: -40, duration: 0.4 }, 6.5);
tl.to("#s1-subtitle", { opacity: 0, duration: 0.3 }, 6.7);
// transition fires on empty frame
```

**正确 — 仅入场，转场处理退场：**

```js
// Scene 1 entrance animations
tl.from("#s1-title", { y: 50, opacity: 0, duration: 0.7, ease: "power3.out" }, 0.3);
tl.from("#s1-subtitle", { y: 30, opacity: 0, duration: 0.5, ease: "power2.out" }, 0.6);
// NO exit tweens — transition at 7.2s handles the scene change
// Scene 2 entrance animations
tl.from("#s2-heading", { x: -40, opacity: 0, duration: 0.6, ease: "expo.out" }, 8.0);
```

## 动画护栏

- 第一个动画偏移 0.1–0.3 秒（不要从 t=0 开始）
- 入场补间之间变化缓动 — 每个场景至少使用 3 种不同缓动
- 同一场景内不要重复入场模式
- 避免在深色背景上使用全屏线性渐变（H.264 色带 — 使用径向或纯色 + 局部发光）
- 渲染视频中标题 60px+、正文 20px+、数据标签 16px+
- 数字列使用 `font-variant-numeric: tabular-nums`

如果不存在 `frame.md` 或 `design.md`，遵循 [house-style.md](./house-style.md) 的美学默认值。

## 字体与资源

- **内置字体：** 在 CSS 中写入你想要的 `font-family` — 编译器自动嵌入支持的字体。
- **自定义字体：** 如果规范（`frame.md` 或 `design.md`）指定了非内置字体，用户必须在 `fonts/` 目录提供 `.woff2` 文件。如果缺失，在编写 HTML 前警告。文件存在时，添加指向本地文件的 `@font-face` 声明。
- 为外部媒体添加 `crossorigin="anonymous"`
- 对于动态文本溢出，使用 `window.__hyperframes.fitTextFontSize(text, { maxWidth, fontFamily, fontWeight })`
- 所有文件位于项目根目录，与 `index.html` 同级；子合成使用 `../`

## 编辑现有合成

- **读取实际文件，不要猜测。** 编辑、扩展或创建配套合成时，阅读现有源码。不要从记忆中重建十六进制代码。不要猜测 GSAP 缓动模式。合成就是规范 — 从中提取精确值。
- 匹配已读内容中的现有字体、颜色、动画模式
- 仅修改被要求修改的内容
- 保留无关剪辑的时间线

## 输出检查清单

**快速（立即运行，阻塞于结果）：**

- [ ] `npx hyperframes lint` 和 `npx hyperframes validate` 均通过
- [ ] 若存在设计规范（`frame.md` 或 `design.md`），已验证设计一致性

**慢速（向用户展示预览时并行运行）：**

- [ ] `npx hyperframes inspect` 通过，或每个报告的溢出均已有意标记
- [ ] 对比度警告已处理（见下方质量检查）
- [ ] 动画编排已验证（见下方质量检查）

## 质量检查

### 视觉检查

`hyperframes inspect` 在无头 Chrome 中运行合成，在时间线上 seek，并映射带时间戳、选择器、边界框和修复提示的视觉布局问题。在 `lint` 和 `validate` 之后运行：

```bash
npx hyperframes inspect
npx hyperframes inspect --json
```

失败通常意味着文本溢出气泡/卡片、固定尺寸标签裁剪动态文案，或文本移出画布。通过增大容器尺寸或 padding、减小字号或字间距、添加真实 `max-width` 使文本在容器内换行，或对动态文案使用 `window.__hyperframes.fitTextFontSize(...)` 来修复。

密集视频使用 `--samples 15`，特定英雄帧使用 `--at 1.5,4,7.25`。重复的静态问题默认折叠，避免淹没代理上下文。如果溢出是入场/退场动画的有意效果，在元素或祖先上标记 `data-layout-allow-overflow`。如果装饰元素不应被审计，标记 `data-layout-ignore`。

`hyperframes layout` 是同一检查的兼容别名。

### 对比度

`hyperframes validate` 默认运行 WCAG 对比度审计。它 seek 到 5 个时间戳，截图页面，采样每个文本元素背后的背景像素，并计算对比度比率。失败显示为警告：

```
⚠ WCAG AA contrast warnings (3):
  · .subtitle "secondary text" — 2.67:1 (need 4.5:1, t=5.3s)
```

如果出现警告：

- 深色背景：提亮失败颜色直至达到 4.5:1（普通文本）或 3:1（大文本，24px+ 或 19px+ 粗体）
- 浅色背景：加深颜色
- 保持在调色板族内 — 不要发明新颜色，调整现有颜色
- 重新运行 `hyperframes validate` 直至干净

快速迭代时可用 `--no-contrast` 跳过，稍后再检查。

### 设计一致性

如果存在设计规范（`frame.md` 或 `design.md`），编写后验证合成是否遵循它。阅读 HTML 并检查：

1. **颜色** — 合成中每个十六进制值都出现在规范的调色板部分（无论用户如何标注：Colors、Palette、Theme 等）。标记任何自行发明的颜色。
2. **字体** — 字体族和字重与规范的类型规范匹配。禁止替换。
3. **圆角** — border-radius 值与声明的圆角风格匹配（如有指定）。
4. **间距** — padding 和 gap 值在声明的密度范围内（如有指定）。
5. **深度** — 阴影使用与声明的深度级别匹配（如有指定：flat = 无，subtle = 轻，layered = 发光）。
6. **避免规则** — 如果规范有列出应避免事项的章节（常见为 "What NOT to Do"、"Don'ts"、"Anti-patterns" 或 "Do's and Don'ts"），验证均未出现。

将违规报告为检查清单。在交付前逐一修复。

如果不存在设计规范（仅 house-style 路径），验证：

1. **调色板一致性** — 所有场景使用相同的 bg、fg 和 accent 颜色。禁止每场景发明颜色。
2. **禁止懒惰默认值** — 对照 house-style.md 的「Lazy Defaults to Question」列表检查合成。如果出现，必须是针对内容的有意选择，而非默认值。

### 动画地图

编写动画后，运行动画地图验证编排：

```bash
node skills/hyperframes/scripts/animation-map.mjs <composition-dir> \
  --out <composition-dir>/.hyperframes/anim-map
```

输出单个 `animation-map.json`，包含：

- **每补间摘要**：`"#card1 animates opacity+y over 0.50s. moves 23px up. fades in. ends at (120, 200)"`
- **ASCII 时间线**：合成时长内所有补间的甘特图
- **交错检测**：报告实际间隔（`"3 elements stagger at 120ms"`）
- **死区**：超过 1 秒无动画的时段 — 有意停留还是缺少入场？
- **元素生命周期**：首次/末次动画时间、最终可见性
- **场景快照**：5 个关键时间戳的可见元素状态
- **标记**：`offscreen`、`collision`、`invisible`、`paced-fast`（低于 0.2 秒）、`paced-slow`（超过 2 秒）

阅读 JSON。扫描摘要中的意外项。检查每个标记 — 修复或说明理由。验证时间线显示预期的编排节奏。修复后重新运行。

小改动（修复颜色、调整一个时长）可跳过。新合成和重大动画变更时运行。

---

## 参考资料（按需加载）

- **[references/captions.md](references/captions.md)** — 与音频同步的字幕、副标题、歌词、卡拉 OK。情绪自适应风格检测、逐词样式、文本溢出预防、字幕退场保证、词分组。添加任何与音频时间同步的文本时阅读。
- **[references/audio-reactive.md](references/audio-reactive.md)** — 音频反应式动画：将频段和振幅映射到 GSAP 属性。视觉应对音乐、语音或声音响应时阅读。
- **[references/css-patterns.md](references/css-patterns.md)** — CSS+GSAP 标记高亮：highlight、circle、burst、scribble、sketchout。确定性、完全可 seek。为文本添加视觉强调时阅读。
- **[references/video-composition.md](references/video-composition.md)** — 视频媒介规则：密度、色彩存在感、尺度、画框构图、设计规范作为品牌而非布局。**始终阅读** — 这些覆盖网页直觉。
- **[references/beat-direction.md](references/beat-direction.md)** — 节拍规划：概念、情绪、编排动词、节奏模板、转场决策、深度层。**多场景合成始终阅读。**
- **[references/typography.md](references/typography.md)** — 字体：字体配对、OpenType 特性、深色背景调整、字体发现脚本。**始终阅读** — 每个合成都有文本。
- **[references/motion-principles.md](references/motion-principles.md)** — 动效设计原则、图像动效处理、load-bearing GSAP 规则。**始终阅读** — 每个合成都有动效。
- **[references/techniques.md](references/techniques.md)** — 13 种基础动画技术及代码模式：SVG 绘制、Canvas 2D、CSS 3D、动感字体、Lottie、视频合成、打字效果、可变字体、MotionPath、速度转场、音频反应式、clip-path 揭示、WebGL 着色器。改编模式 — 不要复制粘贴。（预构建 UI 模板 — 终端 chrome、设备 mockup、情绪板布局 — 见 `registry/blocks/`。）
- **[references/html-in-canvas-patterns.md](references/html-in-canvas-patterns.md)** — HTML-in-Canvas 模式：通过 `drawElementImage` + `layoutsubtree` 将实时 DOM 作为 GPU 纹理。共享样板 + 约 6 种效果配方（iPhone/MacBook mockup、液态玻璃、磁性、传送门、破碎、文本光标）。每个视频 1–3 个英雄节拍时使用。
- **[references/narration.md](references/narration.md)** — 节奏、语气、脚本结构、数字发音、开场白模式。合成包含旁白或 TTS 时阅读。
- **[references/design-picker.md](references/design-picker.md)** — 通过可视化选择器创建 design.md。不存在 `frame.md` 或 `design.md` 且用户想创建一个时阅读。
- **[visual-styles.md](visual-styles.md)** — 8 个命名视觉风格，含十六进制调色板、GSAP 缓动签名和着色器配对。用户指定风格或生成设计规范时阅读。
- **[house-style.md](house-style.md)** — 未指定 `frame.md` 或 `design.md` 时的默认动效、尺寸和调色板。
- **[patterns.md](patterns.md)** — 画中画、标题卡、幻灯片模式。
- **[data-in-motion.md](data-in-motion.md)** — 数据、统计和信息图模式。
- **[references/transcript-guide.md](references/transcript-guide.md)** — 字幕侧转录处理：输入格式、强制质量检查、清理 JS、OpenAI/Groq API 回退、「无转录时」流程。（`transcribe` CLI 调用、模型选择规则和 `.en` 陷阱见 `hyperframes-media` 技能。）
- **[references/dynamic-techniques.md](references/dynamic-techniques.md)** — 动态字幕动画技术（卡拉 OK、clip-path、slam、scatter、elastic、3D）。

- **[references/transitions.md](references/transitions.md)** — 场景转场：交叉淡化、擦除、揭示、着色器转场。能量/情绪选择、CSS vs WebGL 指南。**多场景合成始终阅读** — 无转场的场景感觉像硬切。
  - [transitions/catalog.md](references/transitions/catalog.md) — 硬性规则、场景模板和按类型路由到实现代码。
  - 着色器转场在 `@hyperframes/shader-transitions`（`packages/shader-transitions/`）— 阅读包源码，而非技能文件。

GSAP 模式和效果见 `/gsap` 技能。
