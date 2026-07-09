---
name: gsap
description: HyperFrames 的 GSAP 动画参考。涵盖 gsap.to()、from()、fromTo()、缓动、easing、stagger、defaults、时间轴（gsap.timeline()、位置参数、标签、嵌套、播放控制）以及性能（transforms、will-change、quickTo）。在 HyperFrames 合成中编写 GSAP 动画时使用。
---

# GSAP

## HyperFrames 约定

HyperFrames 通过其 `gsap` 运行时适配器控制 GSAP。同步创建已暂停的时间轴，在 `window.__timelines` 上注册，键名必须与 `data-composition-id` 完全一致，然后由 HyperFrames 对其进行 seek。

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  tl.from(".title", { y: 48, opacity: 0, duration: 0.6, ease: "power3.out" }, 0);
  tl.to(".accent", { scaleX: 1, duration: 0.5, ease: "power2.out" }, 0.25);

  window.__timelines["main"] = tl; // key must equal data-composition-id on the composition root
</script>
```

- 注册表键名必须与合成根元素的 `data-composition-id` 一致。
- 不要为渲染关键动画调用 `tl.play()`。
- 不要在异步代码、定时器或事件处理器中构建时间轴。
- 保持循环有限。HyperFrames 渲染的是有限时长的视频。

## 核心 Tween 方法

- **gsap.to(targets, vars)** — 从当前状态动画到 `vars`。最常用。
- **gsap.from(targets, vars)** — 从 `vars` 动画到当前状态（入场动画）。
- **gsap.fromTo(targets, fromVars, toVars)** — 显式指定起点和终点。
- **gsap.set(targets, vars)** — 立即应用（duration 为 0）。

始终使用 **camelCase** 属性名（例如 `backgroundColor`、`rotationX`）。

## 常用 vars

- **duration** — 秒（默认 0.5）。
- **delay** — 开始前的延迟秒数。
- **ease** — `"power1.out"`（默认）、`"power3.inOut"`、`"back.out(1.7)"`、`"elastic.out(1, 0.3)"`、`"none"`。
- **stagger** — 数字 `0.1` 或对象：`{ amount: 0.3, from: "center" }`、`{ each: 0.1, from: "random" }`。
- **overwrite** — `false`（默认）、`true` 或 `"auto"`。
- **repeat** — 有限次数；在 HyperFrames 中永远不要使用 `-1`。根据可见时长计算重复次数。**yoyo** — 与 repeat 配合，交替方向。
- **onComplete**、**onStart**、**onUpdate** — 回调。
- **immediateRender** — from()/fromTo() 默认为 `true`。对后续作用于同一属性+元素的 tween 设为 `false`，以避免覆盖。

## Transform 与 CSS

优先使用 GSAP 的 **transform 别名**，而非原始 `transform` 字符串：

| GSAP 属性                   | 等价效果            |
| --------------------------- | ------------------- |
| `x`, `y`, `z`               | translateX/Y/Z (px) |
| `xPercent`, `yPercent`      | translateX/Y in %   |
| `scale`, `scaleX`, `scaleY` | scale               |
| `rotation`                  | rotate (deg)        |
| `rotationX`, `rotationY`    | 3D rotate           |
| `skewX`, `skewY`            | skew                |
| `transformOrigin`           | transform-origin    |

- **autoAlpha** — 优先于 `opacity`。为 0 时同时设置 `visibility: hidden`。
- **CSS variables** — `"--hue": 180`。
- **svgOrigin** _(仅 SVG)_ — 全局 SVG 坐标空间原点。不要与 `transformOrigin` 组合使用。
- **Directional rotation** — `"360_cw"`、`"-170_short"`、`"90_ccw"`。
- **clearProps** — `"all"` 或逗号分隔列表；完成时移除内联样式。
- **Relative values** — `"+=20"`、`"-=10"`、`"*=2"`。

## 基于函数的值

```javascript
gsap.to(".item", {
  x: (i, target, targets) => i * 50,
  stagger: 0.1,
});
```

## 缓动（Easing）

内置缓动：`power1`–`power4`、`back`、`bounce`、`circ`、`elastic`、`expo`、`sine`。每种都有 `.in`、`.out`、`.inOut`。

## 默认值

```javascript
gsap.defaults({ duration: 0.6, ease: "power2.out" });
```

## 控制 Tween

```javascript
const tween = gsap.to(".box", { x: 100 });
tween.pause();
tween.play();
tween.reverse();
tween.kill();
tween.progress(0.5);
tween.time(0.2);
```

## gsap.matchMedia()（响应式 + 无障碍）

仅在媒体查询匹配时运行设置；不匹配时自动还原。

```javascript
let mm = gsap.matchMedia();
mm.add(
  {
    isDesktop: "(min-width: 800px)",
    reduceMotion: "(prefers-reduced-motion: reduce)",
  },
  (context) => {
    const { isDesktop, reduceMotion } = context.conditions;
    gsap.to(".box", {
      rotation: isDesktop ? 360 : 180,
      duration: reduceMotion ? 0 : 2,
    });
  },
);
```

---

## 时间轴（Timelines）

### 创建时间轴

```javascript
const tl = gsap.timeline({ defaults: { duration: 0.5, ease: "power2.out" } });
tl.to(".a", { x: 100 }).to(".b", { y: 50 }).to(".c", { opacity: 0 });
```

### 位置参数

第三个参数控制放置位置：

- **Absolute**：`1` — 在 1 秒处
- **Relative**：`"+=0.5"` — 在前一个结束后；`"-=0.2"` — 在前一个结束前
- **Label**：`"intro"`、`"intro+=0.3"`
- **Alignment**：`"<"` — 与上一个同时开始；`">"` — 在上一个结束后；`"<0.2"` — 在上一个开始后 0.2 秒

```javascript
tl.to(".a", { x: 100 }, 0);
tl.to(".b", { y: 50 }, "<"); // same start as .a
tl.to(".c", { opacity: 0 }, "<0.2"); // 0.2s after .b starts
```

### 标签

```javascript
tl.addLabel("intro", 0);
tl.to(".a", { x: 100 }, "intro");
tl.addLabel("outro", "+=0.5");
tl.play("outro");
tl.tweenFromTo("intro", "outro");
```

### 时间轴选项

- **paused: true** — 创建为暂停状态；调用 `.play()` 开始。
- **repeat**、**yoyo** — 应用于整个时间轴。
- **defaults** — 合并到每个子 tween 的 vars。

### 嵌套时间轴

```javascript
const master = gsap.timeline();
const child = gsap.timeline();
child.to(".a", { x: 100 }).to(".b", { y: 50 });
master.add(child, 0);
```

### 播放控制

`tl.play()`、`tl.pause()`、`tl.reverse()`、`tl.restart()`、`tl.time(2)`、`tl.progress(0.5)`、`tl.kill()`。

---

## 性能

### 优先使用 Transform 和 Opacity

动画 `x`、`y`、`scale`、`rotation`、`opacity` 可留在合成器层。当 transform 能达到相同效果时，避免动画 `width`、`height`、`top`、`left`。

### will-change

```css
will-change: transform;
```

仅用于实际会动画的元素。

### gsap.quickTo() 用于频繁更新

```javascript
let xTo = gsap.quickTo("#id", "x", { duration: 0.4, ease: "power3" }),
  yTo = gsap.quickTo("#id", "y", { duration: 0.4, ease: "power3" });
container.addEventListener("mousemove", (e) => {
  xTo(e.pageX);
  yTo(e.pageY);
});
```

### Stagger 优于多个 Tween

使用 `stagger` 代替带手动 delay 的多个独立 tween。

### 清理

暂停或终止屏幕外动画。

---

## 参考资料（按需加载）

- **[references/effects.md](references/effects.md)** — 即插即用效果：打字机文本、音频可视化器。需要 HyperFrames 现成效果模式时阅读。

## 最佳实践

- 使用 camelCase 属性名；优先使用 transform 别名和 autoAlpha。
- 优先使用时间轴而非用 delay 链式串联；使用位置参数。
- 用 `addLabel()` 添加标签，使序列更易读。
- 将 defaults 传入时间轴构造函数。
- 需要控制播放时，保存 tween/时间轴的返回值。

## 禁止事项

- 当 transform 足够时，不要动画布局属性（width/height/top/left）。
- 不要在同一 SVG 元素上同时使用 svgOrigin 和 transformOrigin。
- 当时间轴可以编排序列时，不要用 delay 链式串联动画。
- 不要在 DOM 存在之前创建 tween。
- 不要跳过清理 — 不再需要时务必 kill tween。
- 不要在 HyperFrames 合成中使用无限 repeat 值。根据可见时长计算有限的 repeat 次数。

## 致谢与参考

- HyperFrames 适配器源码：`packages/core/src/runtime/adapters/gsap.ts`。
- GSAP 文档：https://gsap.com/docs/v3/
- GSAP 时间轴暂停与 seek 行为：https://gsap.com/docs/v3/GSAP/Timeline/pause%28%29/
