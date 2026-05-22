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

<p align="center"><b>写 HTML，渲染视频。为 AI agent 而生。</b></p>

<p align="center">
  <a href="README.md">English</a> · <b>简体中文</b>
</p>

<p align="center">
  <img src="https://static.heygen.ai/hyperframes-oss/docs/images/hfgif-1280.webp" alt="HyperFrames 演示 —— 左侧的 HTML 代码会被渲染成右侧的视频" width="800">
</p>

Hyperframes 是一个开源的视频渲染框架，让你用 HTML 编写、预览并渲染视频合成，对 AI agent 提供一等公民的支持。

## 快速开始

### 方案一：搭配 AI 编程助手（推荐）

安装 HyperFrames skills，然后用自然语言描述你想要的视频即可：

```bash
npx skills add heygen-com/hyperframes
```

这一步会教会你的 agent（Claude Code、Cursor、Gemini CLI、Codex）如何写出合法的合成文件、GSAP 时间线、Tailwind v4 浏览器运行时样式，以及一等公民适配器（first-party adapter）的动画用法。在 Claude Code 中，这些 skills 会注册为斜杠命令：用 `/hyperframes` 编写合成；用 `/hyperframes-cli` 执行 dev-loop 命令（init、lint、preview、render）；用 `/hyperframes-media` 做素材预处理（TTS、转写、抠背景）；如果项目用了 `init --tailwind`，用 `/tailwind`；做时间线动画用 `/gsap`；用到第三方运行时时，用对应的适配器 skill（`/animejs`、`/css-animations`、`/lottie`、`/three`、`/waapi`）。

如果你用 Claude Design，请在 GitHub 上打开 [`docs/guides/claude-design-hyperframes.md`](https://github.com/heygen-com/hyperframes/blob/main/docs/guides/claude-design-hyperframes.md)，点下载按钮（↓）保存这份文件，然后把它附加到 Claude Design 对话里。它会生成一个能用的初稿，再丢回任意 AI 编程助手里精修。详见 [Claude Design 指南](https://hyperframes.heygen.com/guides/claude-design)。

如果你专门用 Codex，同样的 skills 也以 [OpenAI Codex 插件](./.codex-plugin/plugin.json) 的形式提供，可以只稀疏安装插件部分：

```bash
codex plugin marketplace add heygen-com/hyperframes --sparse .codex-plugin --sparse skills --sparse assets
```

对于 Claude Code，本仓库还附带了一份 [Claude Code 插件清单](./.claude-plugin/plugin.json)：用 `claude --plugin-dir .` 即可本地试用。这份清单刻意没有列 `skills`，因为 Claude Code 会按约定自动识别根目录下的 `skills/` 文件夹；提交到 marketplace 时，标题请使用 `HyperFrames by HeyGen`，并配合 [`assets/claude-code-icon-dark.svg`](./assets/claude-code-icon-dark.svg) 和 [`assets/claude-code-icon-light.svg`](./assets/claude-code-icon-light.svg) 两份黑/白图标分别对应深色与浅色主题。
对于 Cursor，同样的 skills 也打包成了 [Cursor 插件](./.cursor-plugin/plugin.json) —— 可以从 Cursor Marketplace 安装，也可以克隆仓库后在 **Settings → Plugins → Load unpacked** 里指向仓库根目录进行 sideload。

#### 试一下：示例提示词

把下面任何一条复制到你的 agent 里就能上手。前缀 `/hyperframes` 会显式加载 skill 上下文，第一次输出就能保证正确。

**冷启动 —— 直接描述你想要什么：**

> 用 `/hyperframes` 帮我做一个 10 秒的产品介绍视频：标题淡入、有一段背景视频、再加点背景音乐。

**温启动 —— 把已有内容变成视频：**

> 看看这个 GitHub 仓库 https://github.com/heygen-com/hyperframes ，然后用 `/hyperframes` 给我讲讲它的用途和架构。

> 用 `/hyperframes` 把附件 PDF 总结成一个 45 秒的提案视频。

> 用 `/hyperframes` 把这份 CSV 变成一段动态柱状图竞速动画。

**指定格式：**

> 用 `/hyperframes` 做一个 9:16 的 TikTok 风格钩子视频，主题是 [你的主题]，再配上随 TTS 旁白节奏弹跳的字幕。

**像跟剪辑师对话一样迭代：**

> 把标题放大一倍，切到深色主题，结尾加一个淡出。

> 在 0:03 处加一个下三分之一字幕条，写上我的姓名和职位。

之后 agent 会处理脚手架、动画和渲染。更多用法见 [Prompting 指南](https://hyperframes.heygen.com/guides/prompting)。

### 方案二：手动初始化项目

```bash
npx hyperframes init my-video
cd my-video
npx hyperframes preview      # 在浏览器里预览（带热重载）
npx hyperframes render       # 渲染成 MP4
```

`hyperframes init` 会自动安装 skills，所以你随时都可以把后续工作交给 AI agent。

**环境要求：** Node.js >= 22、FFmpeg

## 为什么选 Hyperframes？

- **HTML 原生** —— 合成就是带 data 属性的 HTML 文件。不用 React，也没有自定义 DSL。
- **AI 优先** —— agent 本来就懂 HTML。CLI 默认非交互，专门为 agent 驱动的工作流设计。
- **确定性渲染** —— 相同输入必然产出完全相同的输出，可放心嵌入自动化流水线。
- **Frame Adapter 模式** —— 自由选择动画运行时（GSAP、Lottie、CSS、Three.js）。

## Hyperframes 与 Remotion 的对比

Hyperframes 的设计灵感来自 [Remotion](https://www.remotion.dev) —— 我们在 HeyGen 的生产环境用过 Remotion，从中学到了很多，也在源码里保留了对它的致敬注释，标注了那些由它率先提出的实现模式（Chrome 启动参数、`image2pipe` → FFmpeg 流式管线、帧缓冲等）。两者都驱动 headless Chrome，也都是确定性渲染。它们的分歧只在一件事上：**作者主要写什么**。Remotion 选的是 React 组件，Hyperframes 选的是 HTML。

|                                                       | **Hyperframes**                | **Remotion**                      |
| ----------------------------------------------------- | ------------------------------ | --------------------------------- |
| 编写形式                                              | HTML + CSS + GSAP              | React 组件（TSX）                 |
| 构建步骤                                              | 无；`index.html` 直接播放      | 必须（需要打包器）                |
| 动画库时钟（GSAP、Anime.js、Motion One）              | 可 seek，逐帧精确              | 渲染时按 wall-clock 播放          |
| 任意 HTML / CSS 直接复用                              | 粘贴进来就能加动画             | 需要改写成 JSX                    |
| 分布式渲染                                            | 当前是单机渲染                 | Lambda，已可用于生产              |

### 许可证：完全开源 vs source-available

**Hyperframes 完全开源，采用 [Apache 2.0](LICENSE)** —— OSI 认可的开源协议。可以无限商用，没有按次渲染费、没有座席上限、也没有公司规模门槛。

**Remotion 是 [source-available，并非开源](https://www.remotion.pro/license)。** 代码在 GitHub 上，但走的是自定义的 Remotion License，超过一定团队规模就需要付费购买公司授权。它是个好产品、背后也有靠谱的团队 —— 但如果开源协议本身对你很重要（OSI 合规、再分发权利、不按次收费），这就是个一阶决策。

完整对比（含基准测试、各自优势的诚实总结、GSAP 并列示例）：**[Hyperframes vs Remotion 指南](https://hyperframes.heygen.com/guides/hyperframes-vs-remotion)**。

## 工作原理

用 HTML 加 data 属性来定义你的视频：

```html
<div id="stage" data-composition-id="my-video" data-start="0" data-width="1920" data-height="1080">
  <video
    id="clip-1"
    data-start="0"
    data-duration="5"
    data-track-index="0"
    src="intro.mp4"
    muted
    playsinline
  ></video>
  <img
    id="overlay"
    class="clip"
    data-start="2"
    data-duration="3"
    data-track-index="1"
    src="logo.png"
  />
  <audio
    id="bg-music"
    data-start="0"
    data-duration="9"
    data-track-index="2"
    data-volume="0.5"
    src="music.wav"
  ></audio>
</div>
```

可以在浏览器里即时预览，也可以本地或 Docker 里渲染成 MP4。

## 内容目录（Catalog）

50+ 个开箱即用的 blocks 和 components —— 社交浮层、shader 转场、数据可视化、电影级特效：

```bash
npx hyperframes add flash-through-white   # shader 转场
npx hyperframes add instagram-follow      # 社交浮层
npx hyperframes add data-chart            # 动态图表
```

完整目录见 **[hyperframes.heygen.com/catalog](https://hyperframes.heygen.com/catalog/blocks/data-chart)**。

## 文档

完整文档见 **[hyperframes.heygen.com/introduction](https://hyperframes.heygen.com/introduction)** —— [快速上手](https://hyperframes.heygen.com/quickstart) | [指南](https://hyperframes.heygen.com/guides/gsap-animation) | [API 参考](https://hyperframes.heygen.com/packages/core) | [Catalog](https://hyperframes.heygen.com/catalog/blocks/data-chart)

## Packages

| Package                                                          | 说明                                                          |
| ---------------------------------------------------------------- | ------------------------------------------------------------- |
| [`hyperframes`](packages/cli)                                    | CLI —— 创建、预览、lint、渲染合成                             |
| [`@hyperframes/core`](packages/core)                             | 类型、解析器、生成器、linter、运行时、frame adapter           |
| [`@hyperframes/engine`](packages/engine)                         | 可 seek 的页面到视频捕获引擎（Puppeteer + FFmpeg）            |
| [`@hyperframes/producer`](packages/producer)                     | 完整渲染流水线（捕获 + 编码 + 音频混合）                      |
| [`@hyperframes/studio`](packages/studio)                         | 基于浏览器的合成编辑器 UI                                     |
| [`@hyperframes/player`](packages/player)                         | 可嵌入的 `<hyperframes-player>` Web Component                 |
| [`@hyperframes/shader-transitions`](packages/shader-transitions) | 用于合成的 WebGL shader 转场                                  |

## Skills

HyperFrames 自带一套 [skills](https://github.com/vercel-labs/skills)，把那些通用文档讲不到位的框架特定模式直接教给 AI agent。

```bash
npx skills add heygen-com/hyperframes
```

| Skill                     | 教什么                                                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `hyperframes`             | HTML 合成编写、字幕、TTS、随音频反应的动画、转场                                                                |
| `hyperframes-cli`         | Dev-loop CLI：init、lint、inspect、preview、render、doctor                                                      |
| `hyperframes-media`       | 素材预处理：tts（Kokoro）、transcribe（Whisper）、remove-background（u2net）—— 包含人声/模型/编码器的选型说明   |
| `hyperframes-registry`    | 通过 `hyperframes add` 安装 block 和 component                                                                  |
| `website-to-hyperframes`  | 抓取一个 URL 把它变成视频 —— 完整的「网站到视频」流水线                                                         |
| `remotion-to-hyperframes` | 把 Remotion（React）合成翻译成 HyperFrames 的 HTML 合成                                                         |
| `gsap`                    | 在 HyperFrames 里用 GSAP timeline：paused 注册、确定性 seek、缓动、序列编排、性能                               |
| `animejs`                 | Anime.js 动画和 timeline 注册到 `window.__hfAnime` 上，配合 HyperFrames 做确定性 seek                           |
| `css-animations`          | HyperFrames 能识别、暂停并 seek 的 CSS keyframe 动画写法                                                        |
| `lottie`                  | `lottie-web` 和 dotLottie 播放器注册到 `window.__hfLottie` 上，配合本地资源并以 paused 状态播放                 |
| `three`                   | Three.js 场景按 HyperFrames 的 `hf-seek` 事件和 `window.__hfThreeTime` 渲染，而不是用 wall-clock 时间           |
| `waapi`                   | Web Animations API 的 `element.animate()` 写法，通过 `document.getAnimations()` 来 seek                         |

## 参与贡献

请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

### 克隆仓库

仓库使用 [Git LFS](https://git-lfs.com) 存放 `packages/producer/tests/**/output.mp4` 下的 golden 回归测试基线（约 240 MB `.mp4` 文件）。如果要完整克隆做开发，请先安装 Git LFS：

```bash
# macOS
brew install git-lfs

# Ubuntu/Debian
sudo apt install git-lfs

# Windows
winget install GitHub.GitLFS
# （或者安装 Git for Windows，它自带 Git LFS 作为可选组件）

# 然后每台机器执行一次
git lfs install
```

如果在 `git clone` 或 `npx skills add heygen-com/hyperframes` 时遇到 `git-lfs filter-process: command not found`，请先装好 Git LFS 再重试。如果你只需要源码、不需要 LFS 内容，也可以跳过：

```bash
GIT_LFS_SKIP_SMUDGE=1 git clone https://github.com/heygen-com/hyperframes.git
```

## License

[Apache 2.0](LICENSE)
