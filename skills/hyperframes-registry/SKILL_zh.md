---
name: hyperframes-registry
description: 将 registry 中的 blocks 和 components 安装并接入 HyperFrames 合成。适用于运行 hyperframes add、安装 block 或 component、将已安装项接入 index.html，或处理 hyperframes.json 的场景。涵盖 add 命令、安装路径、block 子合成接入、component 片段合并，以及 registry 发现。
---

# HyperFrames Registry

registry 提供可复用的 blocks 和 components，可通过 `hyperframes add <name>` 安装。

- **Blocks** — 独立的子合成（composition）（拥有各自的尺寸、时长、时间轴）。通过宿主合成中的 `data-composition-src` 引入。
- **Components** — 效果片段（无独立尺寸）。直接粘贴到宿主合成的 HTML 中。

## 何时使用本技能

- 用户提到 `hyperframes add`、"block"、"component" 或 `hyperframes.json`
- 会话中出现 `hyperframes add` 的输出（文件路径、剪贴板片段）
- 需要将已安装项接入现有合成
- 想要发现 registry 中有哪些可用项

## 快速参考

```bash
hyperframes add data-chart              # install a block
hyperframes add grain-overlay           # install a component
hyperframes add shimmer-sweep --dir .   # target a specific project
hyperframes add data-chart --json       # machine-readable output
hyperframes add data-chart --no-clipboard  # skip clipboard (CI/headless)
```

安装完成后，CLI 会打印写入的文件，以及可粘贴到宿主合成中的片段。该片段只是起点——接入 blocks 时，你还需要添加 `data-composition-id`（必须与 block 内部合成 ID 一致）、`data-start` 和 `data-track-index` 属性。

注意：`hyperframes add` 仅适用于 blocks 和 components。如需 examples，请改用 `hyperframes init <dir> --example <name>`。

## 安装路径

Blocks 默认安装到 `compositions/<name>.html`。
Components 默认安装到 `compositions/components/<name>.html`。

这些路径可在 `hyperframes.json` 中配置：

```json
{
  "registry": "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
  "paths": {
    "blocks": "compositions",
    "components": "compositions/components",
    "assets": "assets"
  }
}
```

完整说明见 [install-locations.md](./references/install-locations.md)。

## 接入 blocks

Blocks 是独立合成——在宿主 `index.html` 中通过 `data-composition-src` 引入：

```html
<div
  data-composition-id="data-chart"
  data-composition-src="compositions/data-chart.html"
  data-start="2"
  data-duration="15"
  data-track-index="1"
  data-width="1920"
  data-height="1080"
></div>
```

关键属性：

- `data-composition-src` — block HTML 文件路径
- `data-composition-id` — 必须与 block 内部 ID 一致
- `data-start` — block 在宿主时间轴上的出现时刻（秒）
- `data-duration` — block 播放时长
- `data-width` / `data-height` — block 画布尺寸
- `data-track-index` — 图层顺序（数值越大越靠前）

完整说明见 [wiring-blocks.md](./references/wiring-blocks.md)。

## 接入 components

Components 是片段——将其 HTML 粘贴到合成的标记中，CSS 粘贴到样式块，JS 粘贴到脚本中（如有）：

1. 读取已安装文件（例如 `compositions/components/grain-overlay.html`）
2. 将 HTML 元素复制到合成的 `<div data-composition-id="...">` 中
3. 将 `<style>` 块复制到合成的样式中
4. 将任意 `<script>` 内容复制到合成的脚本中（放在时间轴代码之前）
5. 若 component 提供 GSAP 时间轴集成（见片段中的注释块），将这些调用添加到你的时间轴中

完整说明见 [wiring-components.md](./references/wiring-components.md)。

## 发现

浏览可用项：

```bash
# Read the registry manifest
curl -s https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry/registry.json
```

每个项的 `registry-item.json` 包含：name、type、title、description、tags、dimensions（仅 blocks）、duration（仅 blocks）和文件列表。

按 type 和 tags 筛选的说明见 [discovery.md](./references/discovery.md)。
