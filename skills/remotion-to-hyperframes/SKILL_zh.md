---
name: remotion-to-hyperframes
description: 将现有的 Remotion（基于 React）视频合成迁移为 HyperFrames HTML 合成。仅在用户明确要求移植、转换、迁移、翻译或重写 Remotion 合成为 HyperFrames 时使用（例如「把我的 Remotion 项目移植到 HyperFrames」）。以下情况不要使用：(a) 编写全新的 HyperFrames 合成（即使在对 Remotion 视频做 A/B 测试）；(b) 仅顺带提到 Remotion；(c) 分享的 Remotion 代码仅作参考，而非用于翻译；(d) 用户想要「和 Remotion 一样的视频」但未明确要求迁移源码——应视为从零构建 HyperFrames。如有疑问，默认使用 `hyperframes` 技能。会检测不支持的写法（useState、useEffect 副作用、async calculateMetadata、第三方 React 组件库、`@remotion/lambda`），并建议采用运行时互操作（runtime interop）逃生舱，而非有损翻译。
---

# Remotion 转 HyperFrames

## 概述

将 Remotion（基于 React）视频合成翻译为 HyperFrames（HTML + GSAP）合成。大多数 Remotion 惯用法在 HyperFrames 中都有直接对应——对约 80% 的典型合成，翻译是机械性的。本技能编码了映射关系，并对不适合 HF 按帧寻址（seek-driven）模型的 20% 有损模式拒绝翻译，转而建议采用 [PR #214](https://github.com/heygen-com/hyperframes/pull/214) 中的运行时互操作模式。

本技能附带**分级测试语料库**（T1–T4，共 4 个 fixture），按测得的 SSIM 阈值对翻译结果评分。未运行评测前不要进行翻译——看起来正确但 SSIM 比已验证基线低 0.05 的翻译，实际上是静默错误的。

## 何时使用

**仅在用户明确要求从 Remotion 迁移时使用本技能。** 示例触发语：

- "port my Remotion project to HyperFrames"
- "convert this Remotion code to HyperFrames"
- "migrate from Remotion"
- "translate this Remotion comp"
- "rewrite this as HyperFrames HTML"

**以下情况不要使用本技能：**

- (a) 用户正在编写**全新**的 HyperFrames 合成，即使其拥有或正在对类似的 Remotion 视频做 A/B 测试。
- (b) 用户仅顺带提到 Remotion，未要求迁移。
- (c) 用户分享的 Remotion 代码仅作参考材料，而非要求翻译。
- (d) 用户要求「和 Remotion 一样的视频」，但未明确要求迁移源码——应视为从零构建 HyperFrames。

如有疑问，默认使用 `hyperframes` 技能编写原生 HyperFrames 合成。

## 工作流

### 步骤 1：对源码进行 Lint

对 Remotion 源码目录运行 [`scripts/lint_source.py`](scripts/lint_source.py)。Lint 会检测无法干净翻译的模式：

- **阻断项**（拒绝翻译 + 建议互操作）：`useState`、`useReducer`、带非空依赖的 `useEffect`/`useLayoutEffect`、async `calculateMetadata`、第三方 React UI 库（MUI、Chakra、Mantine、antd、shadcn、Radix、NextUI）。
- **警告**（丢弃该结构后翻译）：`@remotion/lambda` 配置、`delayRender`、`useCallback`、`useMemo`、自定义 hooks。
- **信息**（翻译并附注）：`staticFile`、`interpolateColors`。

若出现任何阻断项，**停止**。阅读 [`references/escape-hatch.md`](references/escape-hatch.md) 并展示建议信息。警告不会阻止翻译——在步骤 3 中丢弃违规结构，并在 `TRANSLATION_NOTES.md` 中记录缺口。`@remotion/lambda` 配置是典型的警告情形：技能会丢弃 import 与 `renderMediaOnLambda(...)` 调用，但翻译合成的其余部分。

### 步骤 2：规划翻译

阅读 [`references/api-map.md`](references/api-map.md)——所有 Remotion API 及其 HF 等价物或分主题参考的索引。根据源码实际用法，确定需要加载哪些主题参考：

| 源码包含                                                                  | 加载参考                                      |
| ------------------------------------------------------------------------- | --------------------------------------------- |
| `Composition`、`defaultProps`、`schema`、`calculateMetadata`            | [`parameters.md`](references/parameters.md)   |
| `Sequence`、`Series`、`Loop`、`AbsoluteFill`、`Freeze`                    | [`sequencing.md`](references/sequencing.md)   |
| `useCurrentFrame`、`interpolate`、`spring`、`Easing`、`interpolateColors` | [`timing.md`](references/timing.md)           |
| `Audio`、`Video`、`Img`、`IFrame`、`staticFile`、`delayRender`            | [`media.md`](references/media.md)             |
| `TransitionSeries`、`@remotion/transitions`                               | [`transitions.md`](references/transitions.md) |
| `@remotion/lottie`                                                        | [`lottie.md`](references/lottie.md)           |
| `@remotion/google-fonts/<Family>`、`Font.loadFont`、`@font-face`          | [`fonts.md`](references/fonts.md)             |

不要全部加载——只加载该源码实际需要的部分。

### 步骤 3：生成 HF 合成

输出 `index.html`，包含：

- 根元素 `<div id="stage">`，携带合成的 `data-composition-id`、`data-start="0"`、`data-duration`（秒）、`data-fps`、`data-width`、`data-height`，以及每个标量 prop 对应的一个 `data-*`。
- 扁平的场景 div 列表，带 `data-start` / `data-duration` / `data-track-index`。
- 内联 `<style>` 用于布局；CSS 设置每个动画属性的 `from` 状态。
- 底部单个 `<script>` 标签，内含一个已暂停的 `gsap.timeline({paused: true})`。每个 Remotion `useCurrentFrame()` 推导都变为该时间轴上正确偏移处的 tween。
- `window.__timelines["<composition-id>"] = tl;` 向 HF 运行时注册时间轴。

自定义 React 子组件以内联重复 HTML 实现，以 prop 接口为模板（每实例 `data-*` 模式见 [`parameters.md`](references/parameters.md)）。

### 步骤 4：验证

运行评测 harness——完整指南见 [`references/eval.md`](references/eval.md)。快速路径：

```bash
# Render Remotion baseline (after npm install in the fixture)
cd remotion-src && npx remotion render <CompositionId> out/baseline.mp4

# Render HF translation
cd ../hf-src && npx hyperframes render --output ../hf.mp4

# SSIM diff
../../scripts/render_diff.sh ./remotion-src/out/baseline.mp4 ./hf.mp4 ./diff
```

阈值：约比该源码复杂度 tier 的 `p05` 低 0.02（见 `eval.md` 中的已验证阈值表）。若 diff 失败，运行 [`scripts/frame_strip.sh`](scripts/frame_strip.sh) 查看**哪些**帧出现偏差，然后重读相关的 timing/sequencing/media 参考。

**关键**：两次渲染必须使用一致的像素格式。在 Remotion 源码的 `remotion.config.ts` 中设置 `Config.setVideoImageFormat("png")` + `Config.setColorSpace("bt709")`——否则 diff 衡量的是编码器差异（约 0.05 SSIM 损失），而非翻译保真度。

### 步骤 5：记录缺口

任何未能干净翻译的内容（丢弃的音量渐变、近似实现的自定义 presentation、替换的字体等），在 HF 输出旁写入 `TRANSLATION_NOTES.md`。格式见 [`references/limitations.md`](references/limitations.md)。

## 本技能明确不做的事

- **翻译 React 状态机。** 通过 `useState` + `useEffect` 驱动动画的合成，在 HyperFrames 按帧寻址模型中不是确定性的帧捕获目标。建议采用运行时互操作模式。
- **与 HyperFrames 并行运行 Remotion 渲染管线。** 那是 [PR #214](https://github.com/heygen-com/hyperframes/pull/214) 中的运行时互操作模式——针对未通过本技能 lint 的合成，是另一套方案。

（`@remotion/lambda` **不是**阻断项——Lambda 配置属于部署，而非动画。技能会作为警告丢弃它，并翻译其余部分。见 [`references/escape-hatch.md`](references/escape-hatch.md)。）

## 如何为自己的翻译评分

运行测试语料库编排器：

```bash
./assets/test-corpus/run.sh
```

它会运行 T1、T2、T3（渲染 + diff）和 T4（lint 验证），打印按 tier 的通过/失败表，并输出聚合 JSON 报告。用于在干净 checkout 上端到端验证技能是否正常工作——也可在编辑任意参考后作为回归检查。

已验证基线（截至 2026-04-27）：

| Tier | 合成形态                                    | 平均 SSIM | 阈值      |
| ---- | ------------------------------------------- | --------- | --------- |
| T1   | 单元素淡入                                  | 0.974     | 0.95      |
| T2   | 多场景 + spring + 音频 + 图片               | 0.985     | 0.95      |
| T3   | 数据驱动、自定义子组件、数字递增            | 0.953     | 0.90      |
| T4   | 逃生舱（8 个 lint 用例）                    | 8/8 通过  | n/a       |
