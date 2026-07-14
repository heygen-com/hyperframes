---
name: hyperframes-media
description: HyperFrames 合成的素材预处理 — 文本转语音旁白（Kokoro）、音视频转录（Whisper）、以及用于透明叠加层的背景移除（u2net）。适用于从文本生成配音、转录语音以生成字幕、移除视频或图像背景用作透明叠加层、选择 TTS 音色或 Whisper 模型，或串联这些步骤（TTS → 转录 → 字幕）。每条命令在首次运行时会下载各自的模型。
---

# HyperFrames 素材预处理

三条 CLI 命令，用于为合成生成素材：`tts`（语音）、`transcribe`（时间戳）和 `remove-background`（透明视频）。每条命令在首次运行时会下载模型，并缓存在 `~/.cache/hyperframes/` 下。将输出放入项目后，在合成 HTML 中引用 — 音频/视频元素约定见 `hyperframes` 技能。

## 文本转语音（`tts`）

使用 Kokoro-82M 在本地生成语音音频。无需 API 密钥。

```bash
npx hyperframes tts "Text here" --voice af_nova --output narration.wav
npx hyperframes tts script.txt --voice bf_emma --output narration.wav
npx hyperframes tts --list                       # all 54 voices
```

### 音色选择

根据内容匹配合适音色。默认为 `af_heart`。

| 内容类型        | 音色                  | 原因                 |
| --------------- | --------------------- | -------------------- |
| 产品演示        | `af_heart`/`af_nova`  | 温暖、专业           |
| 教程 / 操作指南 | `am_adam`/`bf_emma`   | 中性、易于理解       |
| 营销 / 推广     | `af_sky`/`am_michael` | 有活力或权威感       |
| 文档            | `bf_emma`/`bm_george` | 清晰的英式英语，正式 |
| 休闲 / 社交     | `af_heart`/`af_sky`   | 亲切、自然           |

### 多语言

音色 ID 的首字母编码语言：`a`=美式英语，`b`=英式英语，`e`=西班牙语，`f`=法语，`h`=印地语，`i`=意大利语，`j`=日语，`p`=巴西葡萄牙语，`z`=普通话。CLI 会根据前缀自动检测音素器（phonemizer）区域设置 — 当音色与文本匹配时，无需 `--lang`。

```bash
npx hyperframes tts "La reunión empieza a las nueve" --voice ef_dora --output es.wav
npx hyperframes tts "今日はいい天気ですね" --voice jf_alpha --output ja.wav
```

仅在需要覆盖自动检测时使用 `--lang`（风格化口音）。有效代码：`en-us`、`en-gb`、`es`、`fr-fr`、`hi`、`it`、`pt-br`、`ja`、`zh`。非英语音素化需要系统级安装 `espeak-ng`（`brew install espeak-ng` / `apt-get install espeak-ng`）。

### 语速

- `0.7-0.8` — 教程、复杂内容、无障碍场景
- `1.0` — 自然语速（默认）
- `1.1-1.2` — 片头、转场、轻快内容
- `1.5+` — 很少适用；请仔细测试

### 长脚本

超过几段文字时，写入 `.txt` 文件并传入路径。超过约 5 分钟语音的输入，建议拆分为多段。

### 要求

Python 3.8+，需安装 `kokoro-onnx` 和 `soundfile`（`pip install kokoro-onnx soundfile`）。模型在首次使用时下载（约 311 MB + 约 27 MB 音色文件，缓存在 `~/.cache/hyperframes/tts/`）。

## 转录（`transcribe`）

生成带有词级时间戳的标准化 `transcript.json`。

```bash
npx hyperframes transcribe audio.mp3
npx hyperframes transcribe video.mp4 --model small --language es
npx hyperframes transcribe subtitles.srt          # import existing
npx hyperframes transcribe subtitles.vtt
npx hyperframes transcribe openai-response.json
```

### 语言规则（不可违背）

**除非用户明确说明音频为英语，否则切勿使用 `.en` 模型。** `.en` 模型（`small.en`、`medium.en`）会将非英语音频**翻译**为英语，而非转录。这会静默破坏原始语言。

1. 已知语言且非英语 → `--model small --language <code>`（无 `.en` 后缀）
2. 已知语言且为英语 → `--model small.en`
3. 语言未知 → `--model small`（无 `.en`，无 `--language`）— Whisper 自动检测

**默认模型为 `small`，而非 `small.en`。**

### 模型大小

| 模型       | 大小   | 速度 | 适用场景                   |
| ---------- | ------ | ---- | -------------------------- |
| `tiny`     | 75 MB  | 最快 | 快速预览、测试流水线       |
| `base`     | 142 MB | 快   | 短片段、清晰音频           |
| `small`    | 466 MB | 中等 | **默认** — 大多数内容      |
| `medium`   | 1.5 GB | 慢   | 重要内容、嘈杂音频、含音乐 |
| `large-v3` | 3.1 GB | 最慢 | 生产级质量                 |

含人声的音乐：至少从 `medium` 起步；制作曲目通常需要手动导入 SRT/VTT。字幕质量检查（每次转录后必须执行）、清理 JS、重试规则，以及 OpenAI/Groq API 导入路径，见 [hyperframes/references/transcript-guide.md](../hyperframes/references/transcript-guide.md)。

### 输出结构

合成消费扁平的词对象数组。`id` 字段（`w0`、`w1`、...）在标准化过程中添加，用于字幕覆盖中的稳定引用；为向后兼容，该字段可选。

```json
[
  { "id": "w0", "text": "Hello", "start": 0.0, "end": 0.5 },
  { "id": "w1", "text": "world.", "start": 0.6, "end": 1.2 }
]
```

## 背景移除（`remove-background`）

移除视频或图像的背景，使主体（通常为人 — 虚拟形象、演讲者、出镜人物）作为透明叠加层出现在合成中。

```bash
npx hyperframes remove-background subject.mp4 -o transparent.webm  # default: VP9 alpha WebM
npx hyperframes remove-background subject.mp4 -o transparent.mov   # ProRes 4444 (editing)
npx hyperframes remove-background portrait.jpg -o cutout.png       # single-image cutout
npx hyperframes remove-background subject.mp4 -o subject.webm \
  --background-output plate.webm                                   # both layers in one pass
npx hyperframes remove-background subject.mp4 -o transparent.webm --device cpu
npx hyperframes remove-background --info                           # detected providers
```

使用 `u2net_human_seg`（MIT）。首次运行会将约 168 MB 权重下载到 `~/.cache/hyperframes/background-removal/models/`。

### 图层分离（`--background-output`）

传入 `--background-output`（或 `-b`）可在抠图旁额外输出**第二个**透明视频：源 RGB 相同，alpha 为 `255 − mask` 而非 `mask`。抠图为主体透明背景；底板（plate）为原始环境，主体区域透明。

| 文件                             | Alpha 为…                       | 用途                                 |
| -------------------------------- | ------------------------------- | ------------------------------------ |
| `-o subject.webm`                | 蒙版 — 主体不透明，背景透明     | 前景层，置于顶层                     |
| `--background-output plate.webm` | 反转 — 环境不透明，主体区域透明 | 底层；在底板与主体之间放置文字或图形 |

两个输出共享相同的 `--quality` 预设，且在一次推理中完成 — 编码成本约翻倍，分割成本不变。仅适用于视频输入及 `.webm`/`.mov` 输出。

**挖洞式底板，而非修复式干净底板。** `plate.webm` 中主体区域完全透明 — 在其下方合成不透明内容以填充空洞。判断 `--background-output` 是否合适的唯一标准：_是否会有内容透过主体轮廓（原主体所在位置）可见？_

| 用例                                            | 正确工具                                                          |
| ----------------------------------------------- | ----------------------------------------------------------------- |
| 文字/图形位于抠图与底板之间（本命令存在的理由） | **挖洞式**（`--background-output`）                               |
| 主体叠加到无关场景                              | 仅使用 `subject.webm`；忽略底板                                   |
| 单独展示无人房间，且下方无其他内容              | **干净底板** — 需要修复器（LaMa、ProPainter、E2FGVI）。非本命令。 |
| 用不同主体替换原主体                            | **干净底板** — 同上                                               |

若用户要求「移除人物后的房间」并打算单独展示，**不要**使用 `--background-output`。应告知他们需要修复器（inpainter）。

典型分层合成（挖洞式用法的标准场景）：

```html
<!-- z=1 the inverse-alpha plate fills everything except the subject region -->
<video
  src="plate.webm"
  data-start="0"
  data-duration="6"
  data-track-index="0"
  muted
  playsinline
></video>

<!-- z=2 graphics / text live between the two layers -->
<h1 id="headline" style="z-index:2; ...">MAKE IT IN HYPERFRAMES</h1>

<!-- z=3 the cutout floats the subject back over the headline -->
<div class="cutout-wrap" style="position:absolute;inset:0;z-index:3">
  <video
    src="subject.webm"
    data-start="0"
    data-duration="6"
    data-track-index="1"
    muted
    playsinline
  ></video>
</div>
```

功能上等价于下方的文字在主体后方模式，但项目中无需保留原始 `presenter.mp4` — 底板可替代它。适用于仅交付两个透明层、让用户在中间任意插入内容的场景。

### 输出格式

| 格式                   | 适用场景                                   |
| ---------------------- | ------------------------------------------ |
| `.webm`（VP9 + alpha） | 默认。合成通过 `<video>` 直接播放。        |
| `.mov`（ProRes 4444）  | 在 DaVinci/Premiere/FCP 中编辑。文件较大。 |
| `.png`                 | 单张图像抠图（静态主体，叠加在背景上）。   |

Chrome 原生解码 VP9 alpha，因此 `.webm` 可像其他静音自动播放视频一样接入合成 — `<video>` 轨道约定见 `hyperframes` 技能。

### 质量预设

`--quality fast|balanced|best` 仅控制 VP9 编码器的 CRF — 分割质量固定。

| 预设       | CRF | 适用场景                            |
| ---------- | --- | ----------------------------------- |
| `fast`     | 30  | 迭代调试、较小文件、颜色匹配较宽松  |
| `balanced` | 18  | 默认。大多数场景视觉无差异          |
| `best`     | 12  | 母版 / 最终交付。文件最大，匹配最紧 |

### 合成模式 — 选择正确方案

抠图 webm 是源 mp4 RGB 的**重编码副本**。该选择会影响背后内容的呈现效果：

| 模式                                     | 抠图背后的内容           | 结果                                                                                                                                                                 |
| ---------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **抠图叠加不同场景**（最常见）           | 静态图像、渐变或无关视频 | 效果很好。抠图的 RGB 是主体的唯一来源 — 无重影、无边缘光晕。这正是 `remove-background` 的设计用途。                                                                  |
| **抠图叠加自身源 mp4**（文字在主体后方） | 生成抠图所用的同一 mp4   | 同一人有两个 RGB 来源。默认 `--quality balanced`（crf 18）时重影几乎不可见；`--quality fast`（crf 30）会出现轻微色偏/边缘光晕。母版请用 `--quality best`（crf 12）。 |
| **抠图叠加同一主体的不同镜头**           | 同一主体的其他素材       | 会像两个人重叠。不要这样做。                                                                                                                                         |

**文字在主体后方**（标题在演讲者背后）：

```html
<video
  src="presenter.mp4"
  id="bg"
  data-start="0"
  data-duration="6"
  data-track-index="0"
  muted
  playsinline
></video>
<h1 id="headline" style="z-index:2; ...">MAKE IT IN HYPERFRAMES</h1>
<div class="cutout-wrap" style="position:absolute;inset:0;z-index:3;opacity:0">
  <video
    src="presenter.webm"
    data-start="0"
    data-duration="6"
    data-track-index="1"
    muted
    playsinline
  ></video>
</div>
```

两条关键规则：

1. **将抠图视频包在非定时的 `<div>` 中**，动画作用于包装器的 opacity，而非视频元素本身。框架会强制活动片段（任何带 `data-start`/`data-duration` 的元素）opacity 为 1，因此直接动画视频 opacity 会被静默覆盖。包装器无 `data-*` 属性，由你的 CSS/GSAP 控制。
2. **两个视频均使用 `data-start="0"` 和 `data-media-start="0"`**，使框架从 t=0 同步解码。延后挂载抠图（`data-start=3.3`）会引入 seek + 预热，导致比基础 mp4 晚一帧 — 在切换点可见一帧错位。

然后在切换点用 GSAP 翻转包装器 opacity：`tl.set(cutoutWrap, { opacity: 1 }, 3.3)`。

## TTS → 转录 → 字幕

无预录配音时，先生成语音再转录，以获得词级时间戳用于字幕：

```bash
npx hyperframes tts script.txt --voice af_heart --output narration.wav
npx hyperframes transcribe narration.wav   # → transcript.json
```

Whisper 从生成的音频中提取精确的词边界，字幕时间轴与朗读一致，无需手动微调。
