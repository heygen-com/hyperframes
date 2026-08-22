<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo/dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/logo/light.svg">
    <img alt="HyperFrames" src="docs/logo/light.svg" width="300">
  </picture>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/hyperframes"><img src="https://img.shields.io/npm/v/hyperframes.svg?style=flat" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/hyperframes"><img src="https://img.shields.io/npm/dm/hyperframes.svg?style=flat" alt="npm downloads"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="License"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen" alt="Node.js"></a>
  <a href="https://discord.gg/EbK98HBPdk"><img src="https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white" alt="Discord"></a>
</p>

<p align="center"><b>写 HTML，出视频。为 AI Agent 而生。</b></p>

<p align="center">
  <a href="README.md">English</a>
</p>

<p align="center">
  <a href="https://hyperframes.heygen.com/quickstart">快速开始</a> |
  <a href="https://hyperframes.heygen.com/showcase">案例展示</a> |
  <a href="https://www.hyperframes.dev/">Playground</a> |
  <a href="https://hyperframes.heygen.com/catalog/blocks/data-chart">组件目录</a> |
  <a href="https://hyperframes.heygen.com/introduction">文档</a> |
  <a href="https://discord.gg/EbK98HBPdk">Discord</a>
</p>

<p align="center">
  <img src="docs/public/images/hyperframes-logo-motion-1280-trimmed.webp" alt="HyperFrames 演示：左侧 HTML 代码转化为右侧渲染视频" width="800">
</p>

HyperFrames 是一个开源框架，可将 HTML、CSS、媒体与可寻址动画转化为确定性的 MP4 视频。你可以在本地通过 CLI 使用，在 AI 编程 Agent 中配合 Skills 使用，或作为托管创作工作流的渲染核心。

## 快速开始

### 配合 AI 编程 Agent

安装 HyperFrames Skills，然后描述你想要的视频：

```bash
npx skills add heygen-com/hyperframes --yes
```

可以尝试这样的提示词：

> 使用 `/hyperframes`，创建一个 10 秒的产品介绍视频：标题淡入、背景视频，以及轻柔的背景音乐。

Skills 会教会 Agent HyperFrames 的制作流程：规划视频、编写合规 HTML、接入可寻址动画、添加媒体、lint、预览与渲染。支持 Claude Code、Cursor、Gemini CLI、Codex 及其他支持 Skills 的编程 Agent。

## Skills

HyperFrames 内置 21 个可按需加载的 Agent Skills。请先阅读 `/hyperframes`——它是路由与能力地图，能为任何「帮我做视频」的请求选择合适工作流，并指向下方的领域 Skills。

运行 `npx skills add heygen-com/hyperframes` 进入交互式选择器，`npx skills add heygen-com/hyperframes --all` 一次性安装全部 21 个（跳过选择器），或 `npx skills add heygen-com/hyperframes --skill <name>` 只安装某一个（裸名称，不要前导 `/`）。

### 路由

| Skill          | 适用场景                                                                                                                                                                                                  |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/hyperframes` | **任何**制作 / 创建 / 编辑 / 动画 / 渲染视频、动效或运动图形的请求，**请先阅读**。领域 Skills 的能力地图，以及下方创作工作流的意图路由。 |

### 创作工作流

| Skill                      | 适用场景                                                                                                                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/product-launch-video`    | 营销 / 发布 / 推广**产品**——来自产品 URL、简报或脚本（即使只提到网站名称）。最长约 3 分钟（最佳 30–90 秒）。                                                                               |
| `/website-to-video`        | 将**普通网站**做成视频——站点导览、作品集 / 落地页展示、基于站点视觉的社交短片。                                                                                                          |
| `/faceless-explainer`      | 用任意文本**讲解话题 / 概念**——无产品、无 URL、无网站抓取；所有视觉由 LLM 生成（字体排版 / 抽象图形 / 图解 / 数据可视化）。                                                                |
| `/pr-to-video`             | **GitHub Pull Request**（PR URL、`owner/repo#N` 或「这个 PR」）→ 变更日志 / 功能揭晓 / 修复 / 重构讲解，通过 `gh` CLI 读取。                                                              |
| `/embedded-captions`       | 为现有口播视频添加**字幕 / 说明文字**（原片不动）——逐字轨道、主体后嵌入高潮字幕，或纯电影感嵌入。                                                                                        |
| `/talking-head-recut`      | 为现有口播 / 访谈 / 播客视频包装**设计化图形叠加**——下三分之一、数据标注、动感标题、引用摘录、侧边栏、画中画。                                                                             |
| `/motion-graphics`         | 短时长、**无旁白、设计驱动**的运动图形（通常 &lt;10 秒）——动感字体、数据 / 图表冲击、Logo 片头、下三分之一、推文 / 标题动画。输出 MP4 或透明叠加层。                                       |
| `/music-to-video`          | **音乐曲目**（音频文件，或从视频中提取音频）→ **节拍同步**视频——歌词、幻灯片或动感宣传片；音乐驱动节奏。                                                                                   |
| `/slideshow`               | **演示文稿 / 路演 Deck / 交互式 Deck**——离散幻灯片、片段渐显、分支、热点导航、演讲者模式。输出为可导航 Deck，而非渲染视频。                                                               |
| `/general-video`           | **其他一切**——更长或多场景作品、品牌 / 宣传片、片头、静态循环、自由构图。输入与时长不限的兜底工作流。                                                                                     |
| `/remotion-to-hyperframes` | **迁移现有 Remotion**（React）合成源码到 HyperFrames HTML。单向迁移，非创作工作流。                                                                                                      |

### 领域 Skills（按需加载）

创作工作流所组合的原子能力——需要某一层时单独拉取。

| Skill                    | 覆盖范围                                                                                                                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/hyperframes-core`      | 合成契约——`data-*` 时间属性、`class="clip"`、轨道、子合成、变量、框架托管媒体播放、确定性规则。                                                                                                              |
| `/hyperframes-animation` | 全部动画知识——原子运动规则、场景蓝图、转场、运行时适配器（GSAP / Lottie / Three.js / Anime.js / CSS / WAAPI / TypeGPU）。                                                                                   |
| `/hyperframes-keyframes` | 跨运行时可寻址关键帧编写——GSAP 时间轴、CSS 关键帧、Anime.js、WAAPI、FLIP、路径、遮罩、SVG 形变 / 描边、3D 景深——以及 `hyperframes keyframes` 诊断已渲染运动。                                               |
| `/hyperframes-creative`  | 非动画创意方向——`frame.md` / `design.md`、色板、字体、旁白、节拍规划、音频响应视觉、构图模式。                                                                                                              |
| `/hyperframes-media`     | 音频与媒体——TTS 旁白、背景音乐、音效、Whisper 转写、背景抠除、字幕编写（共享音频引擎）。                                                                                                                    |
| `/media-use`             | 将任意媒体需求（BGM、SFX、图片、图标）解析为本地冻结文件 + 台账记录。对 HeyGen 目录的统一动词（`resolve`），带 manifest 追踪。                                                                              |
| `/hyperframes-cli`       | CLI 开发循环——`init`、`lint`、`validate`、`inspect`、`preview`、`render`、`publish`、`doctor`，以及 AWS Lambda 云端渲染（`lambda deploy / render / progress`）。                                          |
| `/hyperframes-registry`  | 通过 `hyperframes add` 安装并接入目录 Blocks 与 Components。向上游贡献新 Block 或 Component 的编写指南。                                                                                                    |
| `/figma`                 | 导入 Figma 资源、Token、组件与分镜区块 → 合成中的动画小样（REST/CLI）以及 Motion 动画与着色器（MCP）。                                                                                                        |

视觉设计交接工作流请参阅 [Claude Design 指南](https://hyperframes.heygen.com/guides/claude-design) 与 [Open Design 指南](https://hyperframes.heygen.com/guides/open-design)。

### 手动使用 CLI

```bash
npx hyperframes init my-video
cd my-video
npx hyperframes preview      # 浏览器预览，支持热重载
npx hyperframes render       # 渲染为 MP4
```

**环境要求：** Node.js 22+、FFmpeg

## 你能做什么

需要灵感？浏览 [案例展示](https://hyperframes.heygen.com/showcase)——可观看、阅读、运行与二次创作的成品视频。

- 产品发布视频与功能公告
- 带动画代码 Diff、旁白与字幕的 PR 讲解
- 数据可视化、图表竞赛与地图动画
- 带动感字幕、叠加层与音乐的社交视频
- 文档转视频、PDF 转视频、网站转视频讲解
- 自动化内容流水线中的可复用运动图形

## Frame.md

**frame.md——你的设计系统，为镜头而生。**

每个品牌都有 `design.md`，但都不是为摄像机写的。`frame.md` 是缺失的翻译层：它把你的 Web 语境设计规范「翻转」为帧语境——同样的 Token、同样的规则，但重写后 AI Agent 可以构图宣传片，而不用猜测缩放或误用 Web 界面元素。

输出是整套工具链都能读取的 `DESIGN.md` 超集。原子保持神圣，构图保持自由，数字来自脚本。

<table>
  <tr>
    <td width="50%" align="center">
      <a href="https://www.hyperframes.dev/design/biennale-yellow"><img src="https://static.heygen.ai/hyperframes-oss/docs/images/design-templates/biennale-yellow.png" alt="Biennale Yellow" width="100%"></a>
      <br><b><a href="https://www.hyperframes.dev/design/biennale-yellow">Biennale Yellow</a></b>
    </td>
    <td width="50%" align="center">
      <a href="https://www.hyperframes.dev/design/blockframe"><img src="https://static.heygen.ai/hyperframes-oss/docs/images/design-templates/blockframe.png" alt="BlockFrame" width="100%"></a>
      <br><b><a href="https://www.hyperframes.dev/design/blockframe">BlockFrame</a></b>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <a href="https://www.hyperframes.dev/design/blue-professional"><img src="https://static.heygen.ai/hyperframes-oss/docs/images/design-templates/blue-professional.png" alt="Blue Professional" width="100%"></a>
      <br><b><a href="https://www.hyperframes.dev/design/blue-professional">Blue Professional</a></b>
    </td>
    <td width="50%" align="center">
      <a href="https://www.hyperframes.dev/design/bold-poster"><img src="https://static.heygen.ai/hyperframes-oss/docs/images/design-templates/bold-poster.png" alt="Bold Poster" width="100%"></a>
      <br><b><a href="https://www.hyperframes.dev/design/bold-poster">Bold Poster</a></b>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <a href="https://www.hyperframes.dev/design/broadside"><img src="https://static.heygen.ai/hyperframes-oss/docs/images/design-templates/broadside.png" alt="Broadside" width="100%"></a>
      <br><b><a href="https://www.hyperframes.dev/design/broadside">Broadside</a></b>
    </td>
    <td width="50%" align="center">
      <a href="https://www.hyperframes.dev/design/capsule"><img src="https://static.heygen.ai/hyperframes-oss/docs/images/design-templates/capsule.png" alt="Capsule" width="100%"></a>
      <br><b><a href="https://www.hyperframes.dev/design/capsule">Capsule</a></b>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <a href="https://www.hyperframes.dev/design/cartesian"><img src="https://static.heygen.ai/hyperframes-oss/docs/images/design-templates/cartesian.png" alt="Cartesian" width="100%"></a>
      <br><b><a href="https://www.hyperframes.dev/design/cartesian">Cartesian</a></b>
    </td>
    <td width="50%" align="center">
      <a href="https://www.hyperframes.dev/design/cobalt-grid"><img src="https://static.heygen.ai/hyperframes-oss/docs/images/design-templates/cobalt-grid.png" alt="Cobalt Grid" width="100%"></a>
      <br><b><a href="https://www.hyperframes.dev/design/cobalt-grid">Cobalt Grid</a></b>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <a href="https://www.hyperframes.dev/design/coral"><img src="https://static.heygen.ai/hyperframes-oss/docs/images/design-templates/coral.png" alt="Coral" width="100%"></a>
      <br><b><a href="https://www.hyperframes.dev/design/coral">Coral</a></b>
    </td>
    <td width="50%" align="center">
      <a href="https://www.hyperframes.dev/design/creative-mode"><img src="https://static.heygen.ai/hyperframes-oss/docs/images/design-templates/creative-mode.png" alt="Creative Mode" width="100%"></a>
      <br><b><a href="https://www.hyperframes.dev/design/creative-mode">Creative Mode</a></b>
    </td>
  </tr>
</table>

在 [hyperframes.dev/design](https://www.hyperframes.dev/design) 浏览并二次创作全部模板。

## 工作原理

用 HTML 定义视频。用 data 属性标注时间与轨道。用 GSAP、CSS、Lottie、Three.js、Anime.js、WAAPI 或自定义帧适配器实现可寻址动画。

```html
<div id="stage" data-composition-id="launch" data-start="0" data-width="1920" data-height="1080">
  <video
    class="clip"
    data-start="0"
    data-duration="6"
    data-track-index="0"
    src="intro.mp4"
    muted
    playsinline
  ></video>

  <h1 id="title" class="clip" data-start="1" data-duration="4" data-track-index="1">Launch day</h1>

  <audio
    data-start="0"
    data-duration="6"
    data-track-index="2"
    data-volume="0.5"
    src="music.wav"
  ></audio>

  <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script>
    const tl = gsap.timeline({ paused: true });
    tl.from("#title", { opacity: 0, y: 40, duration: 0.8 }, 1);
    window.__timelines = window.__timelines || {};
    window.__timelines.launch = tl;
  </script>
</div>
```

在浏览器中即时预览。本地或 Docker 渲染。渲染器在无头 Chrome 中逐帧寻址，再用 FFmpeg 编码，相同输入产生相同视频。

## HyperFrames 技术栈

HyperFrames 是开源渲染引擎，以及围绕 HTML 原生视频创作的一系列工具。

| 模块                                            | 状态                | 作用                                                                                              |
| ----------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------- |
| CLI                                             | 可用                | 脚手架、预览、lint、检查与渲染本地视频项目                                                        |
| Core / Engine / Producer                        | 可用                | 解析合成、驱动无头 Chrome、编码视频、混音                                                           |
| Catalog                                         | 可用                | 可复用 Blocks 与 Components：转场、叠加层、字幕、图表、地图与特效                                   |
| Agent Skills                                    | 可用                | 教会编程 Agent 通用 Web 文档未覆盖的视频制作模式                                                  |
| Studio                                          | 可用，持续演进      | 浏览器端预览与编辑合成界面                                                                        |
| AWS Lambda 渲染                                 | 可用                | 部署分布式渲染栈，从笔记本或 CI 驱动渲染                                                          |
| [hyperframes.dev](https://www.hyperframes.dev/) | 可用                | 社区 Playground：预览、迭代、分享与渲染 HTML 原生视频项目                                         |
| [frame.md](https://www.hyperframes.dev/design)  | 可用                | 将设计系统翻转为镜头语境——Agent 可据此构图视频的 DESIGN.md 超集                                   |

## 组件目录

安装即用 Blocks 与 Components：

```bash
npx hyperframes add flash-through-white   # 着色器转场
npx hyperframes add instagram-follow      # 社交叠加层
npx hyperframes add data-chart            # 动画图表
```

在 [hyperframes.heygen.com/catalog](https://hyperframes.heygen.com/catalog/blocks/data-chart) 浏览目录。

## 为什么选择 HyperFrames？

- **HTML 原生：** 合成即带 data 属性的 HTML 文件。无需 React，无专有时间轴格式。
- **Agent 友好：** Agent 本来就会写 HTML，CLI 默认非交互。
- **确定性：** 相同输入、相同帧、相同输出。为 CI、回归测试与自动化渲染而设计。
- **无需构建：** `index.html` 合成可直接播放，并在浏览器中预览。
- **适配器化动画：** 可选用 GSAP、CSS 动画、Lottie、Three.js、Anime.js、WAAPI 或自定义运行时。
- **开源：** Apache 2.0 许可，无按次渲染费用或商用门槛。

## HyperFrames vs Remotion

HyperFrames 受 [Remotion](https://www.remotion.dev) 启发。两者都用无头 Chrome 与 FFmpeg 渲染视频。主要区别在于创作模型：Remotion 押注 React 组件；HyperFrames 押注人类与 Agent 都易写的纯 HTML。

|                          | **HyperFrames**                       | **Remotion**                            |
| ------------------------ | ------------------------------------- | --------------------------------------- |
| 创作方式                 | HTML + CSS + 可寻址动画               | React 组件                              |
| 构建步骤                 | 无；`index.html` 直接可用             | 需要打包工具                            |
| Agent 交接               | 纯 HTML 文件                          | JSX / React 项目                        |
| 库时钟动画               | 通过适配器可寻址、逐帧精确            | 墙钟动画模式需额外注意                  |
| 分布式渲染               | 本地与 AWS Lambda 渲染路径            | Remotion Lambda，成熟的云端渲染器       |
| 许可证                   | Apache 2.0                            | 源码可用的 Remotion License             |

完整对比见 [HyperFrames vs Remotion 指南](https://hyperframes.heygen.com/guides/hyperframes-vs-remotion)。

## 文档

完整文档：[hyperframes.heygen.com/introduction](https://hyperframes.heygen.com/introduction)

- [快速开始](https://hyperframes.heygen.com/quickstart)
- [案例展示](https://hyperframes.heygen.com/showcase)
- [指南](https://hyperframes.heygen.com/guides/gsap-animation)
- [API 参考](https://hyperframes.heygen.com/packages/core)
- [组件目录](https://hyperframes.heygen.com/catalog/blocks/data-chart)
- [示例](https://hyperframes.heygen.com/examples)
- [AWS Lambda 渲染](https://hyperframes.heygen.com/deploy/aws-lambda)

## 软件包

| 软件包                                                           | 说明                                                              |
| ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| [`hyperframes`](packages/cli)                                    | 创建、预览、lint 与渲染合成的 CLI                                 |
| [`@hyperframes/core`](packages/core)                             | 类型、解析器、生成器、linter、运行时与帧适配器                    |
| [`@hyperframes/engine`](packages/engine)                         | 基于 Puppeteer 与 FFmpeg 的可寻址页面转视频捕获引擎               |
| [`@hyperframes/producer`](packages/producer)                     | 捕获、编码与混音的完整渲染流水线                                  |
| [`@hyperframes/studio`](packages/studio)                         | 浏览器端合成编辑器 UI                                             |
| [`@hyperframes/player`](packages/player)                         | 可嵌入的 `<hyperframes-player>` Web 组件                          |
| [`@hyperframes/shader-transitions`](packages/shader-transitions) | 合成用 WebGL 着色器转场                                           |
| [`@hyperframes/aws-lambda`](packages/aws-lambda)                 | 分布式渲染的 AWS Lambda SDK 与部署面                              |

## 社区

HyperFrames 已在 [HeyGen](https://www.heygen.com) 生产环境使用，社区案例包括 [tldraw](https://tldraw.com)、[TanStack](https://tanstack.com) 等团队，详见 [ADOPTERS.md](ADOPTERS.md)。若你的团队也在使用，欢迎提 PR。

- 问题与想法：[Discord](https://discord.gg/EbK98HBPdk)
- Bug 与功能请求：[GitHub Issues](https://github.com/heygen-com/hyperframes/issues)
- 安全报告：[SECURITY.md](SECURITY.md)
- 贡献指南：[CONTRIBUTING.md](CONTRIBUTING.md)

## 开发说明

本仓库对 `packages/producer/tests/**/output.mp4` 下的黄金回归测试基线使用 [Git LFS](https://git-lfs.com)（约 240 MB 的 `.mp4` 文件）。若需完整克隆仓库进行开发，请先安装 Git LFS：

```bash
# macOS
brew install git-lfs

# Ubuntu / Debian
sudo apt install git-lfs

# Windows
winget install GitHub.GitLFS

# 每台机器只需执行一次
git lfs install
```

若只需要源码，可跳过 LFS 内容：

```bash
GIT_LFS_SKIP_SMUDGE=1 git clone https://github.com/heygen-com/hyperframes.git
```

## 许可证

[Apache 2.0](LICENSE)
