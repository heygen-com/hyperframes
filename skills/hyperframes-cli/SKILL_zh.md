---
name: hyperframes-cli
description: HyperFrames CLI 开发循环 — 使用 `npx hyperframes` 进行脚手架搭建（init）、验证（lint、inspect）、预览、渲染以及环境排障（doctor、browser、info、upgrade）。在运行这些命令或排查 HyperFrames 构建/渲染环境时使用。对于资源预处理命令（`tts`、`transcribe`、`remove-background`），请改用 `hyperframes-media` 技能。
---

# HyperFrames CLI

所有操作均通过 `npx hyperframes` 执行。需要 Node.js >= 22 和 FFmpeg。

## 工作流

1. **脚手架搭建** — `npx hyperframes init my-video`
2. **编写** — 编写 HTML 合成（参见 `hyperframes` 技能）
3. **Lint** — `npx hyperframes lint`
4. **视觉检查** — `npx hyperframes inspect`
5. **预览** — `npx hyperframes preview`
6. **渲染** — `npx hyperframes render`

预览前先执行 lint 和 inspect。`lint` 可发现缺失的 `data-composition-id`、轨道重叠以及未注册的时间线。`inspect` 在无头 Chrome 中打开渲染后的合成，沿时间线逐帧跳转，并报告文本溢出气泡/容器或超出画布的情况。

## 脚手架搭建

```bash
npx hyperframes init my-video                        # interactive wizard
npx hyperframes init my-video --example warm-grain   # pick an example
npx hyperframes init my-video --video clip.mp4        # with video file
npx hyperframes init my-video --audio track.mp3       # with audio file
npx hyperframes init my-video --example blank --tailwind # with Tailwind v4 browser runtime
npx hyperframes init my-video --non-interactive       # skip prompts (CI/agents)
```

模板：`blank`、`warm-grain`、`play-mode`、`swiss-grid`、`vignelli`、`decision-tree`、`kinetic-type`、`product-promo`、`nyt-graph`。

`init` 会创建正确的文件结构、复制媒体、使用 Whisper 转录音频，并安装 AI 编码技能。应使用它，而不是手动创建文件。

使用 `--tailwind` 时，在编辑 class 或主题 token 之前先调用 `tailwind` 技能。脚手架通过浏览器运行时（browser runtime）使用 Tailwind v4.2，而非 Studio 的 Tailwind v3 配置。

## Lint

```bash
npx hyperframes lint                  # current directory
npx hyperframes lint ./my-project     # specific project
npx hyperframes lint --verbose        # info-level findings
npx hyperframes lint --json           # machine-readable
```

对 `index.html` 以及 `compositions/` 下的所有文件执行 lint。报告错误（必须修复）、警告（应当修复）以及信息（配合 `--verbose`）。

## 视觉检查

```bash
npx hyperframes inspect                 # inspect rendered layout over the timeline
npx hyperframes inspect ./my-project    # specific project
npx hyperframes inspect --json          # agent-readable findings
npx hyperframes inspect --samples 15    # denser timeline sweep
npx hyperframes inspect --at 1.5,4,7.25 # explicit hero-frame timestamps
```

在 `lint` 和 `validate` 之后使用，尤其适用于带对话气泡、卡片、字幕或紧凑排版的合成。它会报告：

- 文本超出最近的视觉容器或气泡
- 文本被自身固定宽/高的盒子裁剪
- 文本超出合成画布
- 子元素逃出裁剪容器

渲染前应修复错误。警告会展示给 agent 审阅；添加 `--strict` 可在警告时也失败。默认会折叠重复的静态问题，使 JSON 输出对 LLM 上下文窗口保持紧凑。若溢出是入场/退场动画的有意效果，在元素或其祖先上标记 `data-layout-allow-overflow`。若装饰性元素不应被审计，用 `data-layout-ignore` 标记。

`npx hyperframes layout` 仍可作为同一视觉检查流程的兼容别名使用。

## 预览

```bash
npx hyperframes preview                   # serve current directory
npx hyperframes preview --port 4567       # custom port (default 3002)
```

文件变更时热重载。会自动在浏览器中打开 Studio。

将项目交还给用户时，应使用 Studio 项目 URL，而非源 `index.html` 路径：

```text
http://localhost:<port>/#project/<project-name>
```

使用预览输出中的实际端口和项目目录名。例如，在 `codex-openai-video` 中执行 `npx hyperframes preview --port 3017` 后，应报告 `http://localhost:3017/#project/codex-openai-video`。

将 `index.html` 仅视为源代码上下文。可以将其作为实现文件链接，但不要将其标注为项目或预览界面。

## 渲染

```bash
npx hyperframes render                                # standard MP4
npx hyperframes render --output final.mp4             # named output
npx hyperframes render --quality draft                # fast iteration
npx hyperframes render --fps 60 --quality high        # final delivery
npx hyperframes render --format webm                  # transparent WebM
npx hyperframes render --docker                       # byte-identical
```

| 标志                 | 选项               | 默认值                    | 说明                                                              |
| -------------------- | --------------------- | -------------------------- | ------------------------------------------------------------------ |
| `--output`           | path                  | renders/name_timestamp.mp4 | 输出路径                                                        |
| `--fps`              | 24, 30, 60            | 30                         | 60fps 会使渲染时间翻倍                                          |
| `--quality`          | draft, standard, high | standard                   | 迭代时使用 draft                                                |
| `--format`           | mp4, webm             | mp4                        | WebM 支持透明通道                                         |
| `--workers`          | 1-8 or auto           | auto                       | 每个 worker 会启动一个 Chrome                                                 |
| `--docker`           | flag                  | off                        | 可复现的输出                                                |
| `--gpu`              | flag                  | off                        | GPU 加速编码                                           |
| `--strict`           | flag                  | off                        | 遇到 lint 错误时失败                                                |
| `--strict-all`       | flag                  | off                        | 错误与警告均失败                                        |
| `--variables`        | JSON object           | —                          | 覆盖 `data-composition-variables` 中声明的变量值  |
| `--variables-file`   | path                  | —                          | 含变量值的 JSON 文件（`--variables` 的替代方式）      |
| `--strict-variables` | flag                  | off                        | 当 `--variables` 中存在未声明的键或类型不匹配时使渲染失败 |

**质量建议：** 迭代时用 `draft`，审阅用 `standard`，最终交付用 `high`。

**参数化渲染：** 合成在 `<html>` 根节点通过 **`data-composition-variables`** 声明变量 — 这是一个 JSON **声明数组**（每项为 `{id, type, label, default}`），用于定义 schema。内部脚本通过 `window.__hyperframes.getVariables()` 读取解析后的值。CLI 的 **`--variables '{"title":"Q4 Report"}'`** 是按 id 为键的 JSON **对象**，用于在一次渲染中覆盖上述默认声明；未提供的键会沿用默认值，因此同一合成在开发预览与生产环境中可保持一致运行。（子合成宿主也可通过 **`data-variable-values`** 按实例覆盖 — 对象形状相同，作用域限于该子合成的一次挂载。完整模式见 `hyperframes` 技能。）

## 资源预处理

`npx hyperframes tts`、`transcribe` 和 `remove-background` 会生成可放入合成的资源（旁白音频、词级转录、透明视频）。各命令首次运行时会下载各自模型。关于音色选择、Whisper 模型规则（`.en` 会把非英语翻译成英语的坑）、输出格式选择（VP9 带 alpha 的 WebM 与 ProRes），以及 TTS → transcribe → 字幕链路，请调用 `hyperframes-media` 技能。

## 排障

```bash
npx hyperframes doctor       # check environment (Chrome, FFmpeg, Node, memory)
npx hyperframes browser      # manage bundled Chrome
npx hyperframes info         # version and environment details
npx hyperframes upgrade      # check for updates
```

渲染失败时先运行 `doctor`。常见问题：缺少 FFmpeg、缺少 Chrome、内存不足。

## 其他

```bash
npx hyperframes compositions   # list compositions in project
npx hyperframes docs           # open documentation
npx hyperframes benchmark .    # benchmark render performance
```
