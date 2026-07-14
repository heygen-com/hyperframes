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

<p align="center"><b>编写 HTML。渲染视频。为 Agent 而生。</b></p>

<p align="center">
  <a href="https://hyperframes.heygen.com/quickstart">快速入门</a> |
  <a href="https://hyperframes.heygen.com/showcase">作品展示</a> |
  <a href="https://www.hyperframes.dev/">Playground</a> |
  <a href="https://hyperframes.heygen.com/catalog/blocks/data-chart">目录</a> |
  <a href="https://hyperframes.heygen.com/introduction">文档</a> |
  <a href="https://discord.gg/EbK98HBPdk">Discord</a>
</p>

<p align="center">
  <img src="https://static.heygen.ai/hyperframes-oss/docs/images/hfgif-1280.webp" alt="HyperFrames 演示：左侧 HTML 代码转换为右侧渲染视频" width="800">
</p>

HyperFrames 是一个开源框架，可将 HTML、CSS、媒体与可寻址动画（seekable animations）转换为确定性的 MP4 视频。你可以在本地通过 CLI 使用，通过 AI 编程 Agent 配合 skills 使用，或作为托管创作工作流背后的渲染核心。

## 快速入门

### 使用 AI 编程 Agent

安装 HyperFrames skills，然后描述你想要的视频：

```bash
npx skills add heygen-com/hyperframes
```

可以尝试这样的提示词：

> 使用 `/hyperframes`，创建一个 10 秒的产品介绍视频，包含淡入标题、背景视频和轻柔的背景音乐。

这些 skills 会教 Agent 掌握 HyperFrames 的制作流程：规划视频、编写合法 HTML、接入可寻址动画、添加媒体、lint、预览和渲染。它们适用于 Claude Code、Cursor、Gemini CLI、Codex 以及其他支持 skills 的编程 Agent。

关于视觉设计交接工作流，请参阅 [Claude Design 指南](https://hyperframes.heygen.com/guides/claude-design) 和 [Open Design 指南](https://hyperframes.heygen.com/guides/open-design)。

### 手动使用 CLI

```bash
npx hyperframes init my-video
cd my-video
npx hyperframes preview      # preview in browser with live reload
npx hyperframes render       # render to MP4
```

**要求：** Node.js 22+、FFmpeg

## 你可以构建什么

需要灵感？浏览 [作品展示](https://hyperframes.heygen.com/showcase)，观看、阅读、运行并改编已完成的视频。

- 产品发布视频与功能公告
- 带动画代码 diff、旁白和字幕的 PR 演示
- 数据可视化、图表竞赛与地图动画
- 带动态字幕、叠加层和音乐的社会化视频
- 文档转视频、PDF 转视频、网站转视频讲解
- 用于自动化内容流水线的可复用动态图形

## Frame.md

**frame.md — 你的设计系统，已为视频就绪。**

每个品牌都有 `design.md`，但都不是为镜头而写。`frame.md` 是缺失的转换层：它接收你的 Web 上下文设计规范，并为画面（frame）做反向适配——同样的 token、同样的规则，但重写后 AI Agent 可以创作宣传视频，而无需猜测缩放或依赖 Web 界面元素。

输出是整套工具链都能读取的 `DESIGN.md` 超集。原子级元素保持神圣不可侵犯。构图保持自由。数值来自脚本。

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

在 [hyperframes.dev/design](https://www.hyperframes.dev/design) 浏览并改编全部模板。

## 工作原理

将视频定义为 HTML。用 data 属性标注时间与轨道。使用 GSAP、CSS、Lottie、Three.js、Anime.js、WAAPI 或你自己的 frame adapter 实现可寻址动画。

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

在浏览器中即时预览。在本地或 Docker 中渲染。渲染器在无头 Chrome 中逐帧寻址，并用 FFmpeg 编码结果，因此相同输入产生相同视频。

## HyperFrames 技术栈

HyperFrames 是开源渲染引擎，以及围绕 HTML 原生视频创作的一整套不断扩展的工具。

| 组件                                            | 状态         | 功能说明                                                                                          |
| ----------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------- |
| CLI                                             | 可用         | 搭建、预览、lint、检查并渲染本地视频项目                                                          |
| Core / Engine / Producer                        | 可用         | 解析合成、驱动无头 Chrome、编码视频并混音                                                         |
| Catalog                                         | 可用         | 可复用的 blocks 与 components：转场、叠加层、字幕、图表、地图与特效                                |
| Agent skills                                    | 可用         | 教编程 Agent 掌握通用 Web 文档未涵盖的视频制作模式                                                |
| Studio                                          | 可用，持续演进 | 用于预览与编辑合成的浏览器界面                                                                    |
| AWS Lambda rendering                            | 可用         | 部署分布式渲染栈，从笔记本或 CI 驱动渲染                                                          |
| [hyperframes.dev](https://www.hyperframes.dev/) | 可用         | 社区 Playground：预览、迭代、分享并渲染 HTML 原生视频项目                                         |
| [frame.md](https://www.hyperframes.dev/design)  | 可用         | 将设计系统反向适配为镜头语言——Agent 可据此创作视频的 DESIGN.md 超集                               |

## 目录

安装即用 blocks 与 components：

```bash
npx hyperframes add flash-through-white   # shader transition
npx hyperframes add instagram-follow      # social overlay
npx hyperframes add data-chart            # animated chart
```

在 [hyperframes.heygen.com/catalog](https://hyperframes.heygen.com/catalog/blocks/data-chart) 浏览目录。

## 为什么选择 HyperFrames？

- **HTML 原生：** 合成即带 data 属性的 HTML 文件。无需 React，无专有时间线格式。
- **Agent 友好：** Agent 本来就会写 HTML，且 CLI 默认非交互式。
- **确定性：** 相同输入、相同帧、相同输出。为 CI、回归测试与自动化渲染而设计。
- **无构建步骤：** `index.html` 合成可直接播放，并在浏览器中直接预览。
- **基于适配器的动画：** 支持 GSAP、CSS 动画、Lottie、Three.js、Anime.js、WAAPI 或自定义运行时。
- **开源：** Apache 2.0 许可证，无按次渲染费用或商业使用门槛。

## HyperFrames vs Remotion

HyperFrames 受 [Remotion](https://www.remotion.dev) 启发。两者都用无头 Chrome 与 FFmpeg 渲染视频。主要区别在于创作模型：Remotion 押注 React 组件；HyperFrames 押注人类与 Agent 都能轻松编写的纯 HTML。

|                          | **HyperFrames**                       | **Remotion**                            |
| ------------------------ | ------------------------------------- | --------------------------------------- |
| 创作方式                 | HTML + CSS + 可寻址动画               | React 组件                              |
| 构建步骤                 | 无；`index.html` 可直接播放           | 需要打包工具                            |
| Agent 交接               | 纯 HTML 文件                          | JSX / React 项目                        |
| 库时钟动画               | 通过适配器可寻址、逐帧精确            | 墙钟动画模式需额外注意                  |
| 分布式渲染               | 本地与 AWS Lambda 渲染路径            | Remotion Lambda，成熟的云渲染器         |
| 许可证                   | Apache 2.0                            | 源码可用的 Remotion License             |

完整对比见 [HyperFrames vs Remotion 指南](https://hyperframes.heygen.com/guides/hyperframes-vs-remotion)。

## 文档

完整文档：[hyperframes.heygen.com/introduction](https://hyperframes.heygen.com/introduction)

- [快速入门](https://hyperframes.heygen.com/quickstart)
- [作品展示](https://hyperframes.heygen.com/showcase)
- [指南](https://hyperframes.heygen.com/guides/gsap-animation)
- [API 参考](https://hyperframes.heygen.com/packages/core)
- [目录](https://hyperframes.heygen.com/catalog/blocks/data-chart)
- [示例](https://hyperframes.heygen.com/examples)
- [AWS Lambda 渲染](https://hyperframes.heygen.com/deploy/aws-lambda)

## 软件包

| 软件包                                                           | 说明                                                              |
| ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| [`hyperframes`](packages/cli)                                    | 用于创建、预览、lint 与渲染合成的 CLI                               |
| [`@hyperframes/core`](packages/core)                             | 类型、解析器、生成器、linter、运行时与 frame adapters               |
| [`@hyperframes/engine`](packages/engine)                         | 基于 Puppeteer 与 FFmpeg 的可寻址页面到视频捕获引擎                 |
| [`@hyperframes/producer`](packages/producer)                     | 完整渲染流水线：捕获、编码与音频混音                                |
| [`@hyperframes/studio`](packages/studio)                         | 基于浏览器的合成编辑器 UI                                           |
| [`@hyperframes/player`](packages/player)                         | 可嵌入的 `<hyperframes-player>` Web 组件                          |
| [`@hyperframes/shader-transitions`](packages/shader-transitions) | 用于合成的 WebGL shader 转场                                        |
| [`@hyperframes/aws-lambda`](packages/aws-lambda)                 | 用于分布式渲染的 AWS Lambda SDK 与部署面                            |

## 社区

HyperFrames 已在 [HeyGen](https://www.heygen.com) 投入生产使用；[tldraw](https://tldraw.com)、[TanStack](https://tanstack.com) 等团队的社区示例见 [ADOPTERS.md](ADOPTERS.md)。若你的团队在使用 HyperFrames，欢迎提交 PR。

- 问题与想法：[Discord](https://discord.gg/EbK98HBPdk)
- Bug 与功能请求：[GitHub Issues](https://github.com/heygen-com/hyperframes/issues)
- 安全报告：[SECURITY.md](SECURITY.md)
- 贡献指南：[CONTRIBUTING.md](CONTRIBUTING.md)

## 开发说明

本仓库对 `packages/producer/tests/**/output.mp4` 下的黄金回归测试基线使用 [Git LFS](https://git-lfs.com)（约 240 MB 的 `.mp4` 文件）。若需克隆完整仓库进行开发，请先安装 Git LFS：

```bash
# macOS
brew install git-lfs

# Ubuntu / Debian
sudo apt install git-lfs

# Windows
winget install GitHub.GitLFS

# Then, once per machine
git lfs install
```

若只需源码文件，可跳过 LFS 内容：

```bash
GIT_LFS_SKIP_SMUDGE=1 git clone https://github.com/heygen-com/hyperframes.git
```

## 许可证

[Apache 2.0](LICENSE)
