---
name: contribute-catalog
description: 编写新的 HyperFrames 注册表 block（字幕样式、VFX block、转场、下三分之一字幕条）或 component（文字效果、叠加层、代码片段），并以上游 PR 的形式提交到 hyperframes 仓库。仅在用户希望向公开目录贡献内容时使用——项目内字幕/转场编写请使用 `hyperframes` 技能，安装现有注册表项请使用 `hyperframes-registry` 技能。
---

# 向 HyperFrames 注册表贡献内容

引导用户从创意到合并 PR，完成新的注册表 block 或 component。

## 工作流程

```
1. Clarify → 2. Scaffold → 3. Build → 4. Validate → 5. Preview → 6. Ship
```

### 步骤 1：明确需求

询问用户要构建什么。注册表有两种条目类型：

- **Block**（`registry/blocks/`，类型 `hyperframes:block`）——具有固定尺寸和时长的完整独立 composition。字幕样式、VFX 效果、标题卡、下三分之一字幕条。
- **Component**（`registry/components/`，类型 `hyperframes:component`）——无固定尺寸或时长的可复用代码片段。CSS 效果、文字处理、可适配任意 composition 尺寸的叠加层。

然后询问：

- 用一句话描述该效果
- 视觉参考（URL、截图或文字描述）
- 谁会使用、在什么场景下使用？

### 步骤 2：搭建脚手架

创建注册表目录结构：

**Block：**

```
registry/blocks/{block-name}/
  {block-name}.html
  registry-item.json
```

**Component：**

```
registry/components/{component-name}/
  {component-name}.html
  registry-item.json
```

**命名约定：**

| 条目名称         | ID 前缀 | 示例 ID                |
| ---------------- | ------- | ---------------------- |
| `cap-hormozi`    | `hz`    | `hz-cg-0`, `hz-cw-3`   |
| `cap-typewriter` | `tw`    | `tw-cg-0`, `tw-ch-0-5` |
| `vfx-chrome`     | `vc`    | `vc-canvas`            |

使用 2–3 个字母的前缀。所有元素 ID 必须使用该前缀，以避免在子 composition 中发生冲突。

**block 的 registry-item.json：**

```json
{
  "$schema": "https://hyperframes.heygen.com/schema/registry-item.json",
  "name": "{block-name}",
  "type": "hyperframes:block",
  "title": "{Human Title}",
  "description": "{one sentence}",
  "dimensions": { "width": 1920, "height": 1080 }, // adjust: 1080x1920 for portrait/social
  "duration": 10, // adjust for your composition
  "tags": ["{category}", "{subcategory}"],
  "files": [
    {
      "path": "{block-name}.html",
      "target": "compositions/{block-name}.html",
      "type": "hyperframes:composition"
    }
  ]
}
```

**component 的 registry-item.json**（无 `dimensions` 或 `duration`）：

```json
{
  "$schema": "https://hyperframes.heygen.com/schema/registry-item.json",
  "name": "{component-name}",
  "type": "hyperframes:component",
  "title": "{Human Title}",
  "description": "{one sentence}",
  "tags": ["{category}"],
  "files": [
    {
      "path": "{component-name}.html",
      "target": "compositions/components/{component-name}.html",
      "type": "hyperframes:snippet"
    }
  ]
}
```

### 步骤 3：构建

根据类型应用正确的模板。可复制粘贴的起步模板见 [templates.md](templates.md)。

#### 字幕 block

**字幕不可妥协的规则：**

- 字体：比例字体至少 **96px**。**等宽字体 64–72px 可接受**（字符更宽，字号可略小）。
- 可读性：`-webkit-text-stroke: 2-3px` 或多层 `text-shadow`
- 溢出：对每个 group 调用 `window.__hyperframes.fitTextFontSize()`
- 卡拉 OK（Karaoke）：通过 `tl.to(wordEl, { color/scale }, WORDS[wi].start)` 高亮当前词
- 强制隐藏（hard kill）：对每个 group 执行 `tl.set(groupEl, { opacity: 0, visibility: "hidden" }, g.end)`
- **切勿在同一位置同时使用 `tl.from(el, { opacity: 0 })` 与 `tl.set(el, { opacity: 1 })`**——`from` 会覆盖 `set`。请改用 `tl.to`。

**逐字符动画**（打字机、scramble 打散等）：

- 将每个字符包在 `<span>` 中，ID 为 `{prefix}-ch-{group}-{char}`
- 根据词时间戳计算间隔，用 `tl.set` 做交错
- 光标/装饰元素：用间隔 `tl.set`——不要用 CSS 动画（不可 seek）

**定位变体：**

- 居中：`display: flex; align-items: center; justify-content: center;`
- 下三分之一：`position: absolute; bottom: 100px; left: 0; width: 100%; text-align: center;`
- 左对齐：`position: absolute; bottom: 100px; left: 120px; text-align: left;`

#### VFX block（Three.js）

- 从 CDN 使用 `three@0.147.0`（全局脚本）
- `tl.eventCallback("onUpdate", renderScene); renderScene();`——不要用 requestAnimationFrame
- 状态代理模式：GSAP 动画普通 JS 对象，渲染函数读取其值
- 随机性使用带种子的 PRNG（`mulberry32`）

#### 所有类型

- `data-composition-id` 必须与 `window.__timelines["id"]` 一致
- 所有元素 ID 以 block 缩写为前缀
- `gsap.timeline({ paused: true })`——始终 paused
- 禁止 `Math.random()`、`Date.now()`

### 步骤 4：验证

```bash
hyperframes lint                    # 0 errors required
hyperframes validate --no-contrast  # 0 console errors required
```

### 步骤 5：预览

```bash
# Render preview video
hyperframes render -o preview.mp4

# Snapshot for visual QA
hyperframes snapshot --at "1.0,3.0,5.0,7.0"

# Publish to hyperframes.dev for review
npx hyperframes publish
```

**目录预览图**——目录卡片使用 `docs/images/catalog/{kind}/{name}.png` 处的 PNG（`{kind}` 为 `blocks` 或 `components`）。从快照生成后：

- **HeyGen 内部贡献者：** 运行 `scripts/upload-docs-images.sh`（需要 AWS profile `engineering-767398024897`）
- **外部贡献者：** 将预览 MP4 附在 PR 描述中。维护者会在合并前生成并上传目录图片。

### 步骤 6：发布

**以下步骤均为必填。缺任何一步都会导致目录条目损坏。**

`{kind}` 根据步骤 1 中构建的内容为 `blocks` 或 `components`。

```bash
# 1. Create branch
git checkout -b feat/registry-{name}

# 2. Format HTML
npx oxfmt registry/{kind}/{name}/*.html

# 3. Update registry/registry.json — add entry to the "items" array:
#    { "name": "{name}", "type": "hyperframes:block" }  (or "hyperframes:component")

# 4. Generate catalog docs page
npx tsx scripts/generate-catalog-pages.ts

# 5. Publish to hyperframes.dev so reviewers can preview
npx hyperframes publish

# 6. Stage everything
git add registry/{kind}/{name}/ registry/registry.json docs/catalog/

# 7. Commit
git commit -m "feat(registry): add {name} — {one sentence}"

# 8. Push and open PR with hyperframes.dev link
git push origin feat/registry-{name}
gh pr create --title "feat(registry): {name}" --body "preview: {hyperframes.dev-url}"
```

**若没有 GitHub 账号：** 需要注册才能开 PR。在 https://github.com/signup 注册，然后运行 `gh auth login`。

## 质量门禁

- [ ] `hyperframes lint` → 0 errors
- [ ] `hyperframes validate` → 0 console errors
- [ ] `npx oxfmt --check` 通过
- [ ] `registry/registry.json` 已添加新条目
- [ ] 已运行 `scripts/generate-catalog-pages.ts`（已生成文档页）
- [ ] 已运行 `npx hyperframes publish`（已认领项目 URL）
- [ ] PR 已附预览 MP4（外部）或已上传目录 PNG（内部）
- [ ] 所有 ID 唯一且带前缀
