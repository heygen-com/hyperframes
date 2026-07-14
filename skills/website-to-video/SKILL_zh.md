---
name: website-to-hyperframes
description: |
  抓取网站并从中创建 HyperFrames 视频。适用场景：(1) 用户提供 URL 并希望生成视频，(2) 有人说「抓取这个网站」「把它做成视频」「用我的网站做宣传片」，(3) 用户想要社交广告、产品导览，或基于现有网站的任何视频，(4) 用户分享链接并要求任何类型的视频内容。即使用户只是粘贴了一个 URL——也应使用本技能。
---

# 网站转 HyperFrames

抓取网站，然后从中制作专业视频。

用户可能会这样说：

- "Capture https://... and make me a 25-second product launch video"
- "Turn this website into a 15-second social ad for Instagram"
- "Create a 30-second product tour from https://..."

工作流程共 7 步。每一步都会产出一份产物，作为下一步的门槛。默认采用协作模式——标有 💬 的门槛会暂停并询问用户。若用户表示自主模式（「你帮我决定」「给我惊喜」），则跳过 💬 用户偏好门槛；详见 step-2-brief.md 中的传播方式。

**自主模式并非「跳过所有门槛」。** 自动模式涵盖用户偏好类问题（TTS 提供商、音色、色彩强调、节拍数量、是否配乐、是否加字幕——由代理代用户决定）。它**不**涵盖质量验证门槛。以下门槛在自动模式下仍不可跳过：

- 资产审计（Step 3）——查看联系表并为每项资产说明 USE/SKIP 理由
- 逐节拍 HTML 阅读（Step 5）——每个节拍需有结构化证据块
- DoD 检查清单（Step 6）——包括 animation-map、逐条警告的 WCAG 验证、音频/动效回放
- 诚实披露部分（Step 6）——最终摘要中必须包含「我未验证的内容」

若你发现自己这样想：「自动模式说要偏向行动，所以我跳过 X」——而 X 是验证门槛而非偏好问题——这种推理是错误的。偏向行动适用于决定**构建什么**，而非决定**是否验证**。

---

## Step 0：抓取并理解品牌

**阅读：** [references/step-0-capture.md](references/step-0-capture.md)

抓取网站，然后阅读提取的数据以理解**品牌与产品**——做什么、面向谁、用什么语气、营造什么氛围。抓取的资产是后续使用的品牌工具包，而非直接拼装视频的积木。

**门槛：** 打印网站摘要——策略优先（产品做什么、面向谁、品牌调性），再列出资产/颜色/字体清单。

---

## Step 1：品牌识别

**阅读：** [references/step-1-design.md](references/step-1-design.md)

编写 DESIGN.md——涵盖视觉识别的品牌速查表：颜色、字体、组件样式、布局原则。使用 `design-styles.json` 获取精确计算值。

**快速选项：** 对于快节奏视频（每节拍一块广告牌），DESIGN.md 可以是 50 行的颜色 + 字体 + 注意事项摘要——不必写成 300 行文档。Step 5 的子代理提示会直接粘贴品牌值，因此 DESIGN.md 的深度仅对复杂合成有意义。

**门槛：** `DESIGN.md` 已存在（任意长度），且至少包含：调色板、字体选择、注意事项（do's/don'ts）。

---

## Step 2：策略与信息传达

**阅读：** [references/step-2-brief.md](references/step-2-brief.md)、[references/capabilities.md](references/capabilities.md)（浏览目录——仅在需要时深入阅读具体章节）

在讨论视觉或资产之前，先与用户对齐**视频必须传达什么**。解析用户提示——他们很可能已经给出了视频类型和风格。只问缺失项：这条视频必须说的**一件事**、叙事弧线、以及受众。

**门槛：** 视频类型、时长、格式，以及——关键——信息与叙事弧线已锁定。没有这些，Step 3 无法写出概念优先的分镜。

---

## Step 3：分镜 + 脚本 💬

**阅读：** [references/step-3-storyboard.md](references/step-3-storyboard.md)

概念优先编写分镜：信息 → 叙事弧线 → 服务于弧线的节拍 → 每节拍技法 → 最后做品牌点缀。再编写与之匹配的旁白脚本。向用户展示两者及逐节拍摘要。迭代直至用户批准。

**门槛：** `STORYBOARD.md` + `SCRIPT.md` 已存在，且用户已批准方案。

---

## Step 4：旁白、时间轴与字幕 💬

**阅读：** [references/step-4-vo.md](references/step-4-vo.md)

若 Step 2 表示无需旁白——询问背景音乐，然后跳到 Step 5。否则：询问用户选用哪种 TTS 提供商（HeyGen TTS、ElevenLabs 或 Kokoro），生成音频、转写，将时间戳映射到节拍。再询问字幕。

**门槛：** 满足 (a) 未要求旁白且分镜含手动节拍时间，或 (b) `narration.wav` + `transcript.json` 已存在且节拍时间已按实际时长更新。

---

## Step 5：构建合成

**阅读：** `hyperframes` 技能（加载它——每条规则都重要）
**阅读：** [references/step-5-build.md](references/step-5-build.md)

按 Step 3 分镜所选架构与节奏构建 index.html 与 compositions。子代理在每个节拍回报前运行 `hyperframes lint` 和 `hyperframes snapshot`。

**门槛：** 主代理已对照 DESIGN.md 与 STORYBOARD.md 逐行阅读每个 `compositions/beat-N.html`。逐节拍检查清单见 [step-5-build.md](references/step-5-build.md)。

---

## Step 6：验证与交付

**阅读：** [references/step-6-validate.md](references/step-6-validate.md)

执行 lint、validate，按视频长度缩放拍摄快照（公式：`max(beats × 3, ceil(duration_seconds / 2))`），并逐一审查。交付前修复问题。交付 localhost Studio 项目 URL——仅在用户明确要求时才渲染为 MP4。

**交付你引以为豪的作品。** 交接前自问：我会愿意把自己的名字标在这条社交媒体上发布吗？若不会，先修好问题。

**门槛：** `npx hyperframes lint` 与 `npx hyperframes validate` 零错误通过，且最终回复包含当前 Studio 项目 URL。

---

## 快速参考

### 视频类型

各视频类型的典型约束——作为起点，而非公式。节拍数量应来自内容与旁白，而非目标区间。

| 类型                  | 典型时长 | 时长驱动因素 | 旁白             |
| --------------------- | -------- | ------------ | ---------------- |
| 社交广告（IG/TikTok） | 10–15s   | 平台限制     | 可选             |
| 产品演示              | 30–60s   | 脚本长度     | 完整旁白         |
| 功能发布              | 15–30s   | 功能复杂度   | 完整旁白         |
| 品牌短片              | 20–45s   | 音乐轨道     | 可选，以音乐为主 |
| 发布预告              | 10–20s   | 开场冲击力   | 极简             |

节拍数量有意不在此表中——应来自分镜，而非「社交广告 = 3–4 节拍」。复杂产品的社交广告可能需要 5 个节奏精准的节拍。只有一个强视觉论点的品牌短片可能只需 3 个。

### 格式

- **横屏**：1920x1080（默认）
- **竖屏**：1080x1920（Instagram Stories、TikTok）
- **方形**：1080x1080（Instagram 信息流）

### 参考文件

| 文件                                                                               | 何时阅读                                                                                   |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [step-0-capture.md](references/step-0-capture.md)                                  | Step 0 — 抓取、理解品牌与产品，撰写策略优先的网站摘要                                      |
| [step-1-design.md](references/step-1-design.md)                                    | Step 1 — 编写 DESIGN.md 品牌速查表（5 节，250–350 行；广告牌式社交广告可走 50 行快速路径） |
| [step-2-brief.md](references/step-2-brief.md)                                      | Step 2 — 与用户对齐信息、叙事弧线、受众                                                    |
| [capabilities.md](references/capabilities.md)                                      | Step 2 与 5 — HyperFrames 能力全览（24 节）。简报阶段浏览目录，构建阶段深入具体章节        |
| [step-3-storyboard.md](references/step-3-storyboard.md)                            | Step 3 — 分镜 + 脚本（合并）及用户审阅门槛                                                 |
| [step-4-vo.md](references/step-4-vo.md)                                            | Step 4 — TTS 提供商选择、生成、时间轴                                                      |
| [step-5-build.md](references/step-5-build.md)                                      | Step 5 — 构建 index.html + compositions                                                    |
| [step-6-validate.md](references/step-6-validate.md)                                | Step 6 — lint、validate、快照（按视频长度缩放）、预览                                      |
| [techniques.md](../hyperframes/references/techniques.md)                           | Step 3 与 5 — 13 种基础动效技法及代码模式（适配使用，勿照搬）                              |
| [html-in-canvas-patterns.md](../hyperframes/references/html-in-canvas-patterns.md) | Step 5 — HTML-in-Canvas 效果的完整代码模式（位于 hyperframes 技能中）                      |
