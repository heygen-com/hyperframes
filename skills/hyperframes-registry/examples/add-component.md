# Worked Example: Adding a Component

## Scenario

User wants to add a shimmer light sweep effect to their title text.

## Steps

### 1. Install the component

```bash
hyperframes add shimmer-sweep
```

### 2. Read the snippet

Open `compositions/components/shimmer-sweep.html` and read the comment header.

### 3. Wire into your composition

**HTML** — wrap target elements:

```html
<div class="shimmer-sweep-target" style="--shimmer-color: rgba(255, 255, 255, 0.5)">
  <h1 class="title">AI-Powered Video</h1>
</div>
```

**CSS** — paste the `.shimmer-sweep-target` and `.shimmer-mask` rules from the snippet.

**JS** — paste the auto-injection script (before timeline code):

```js
document.querySelectorAll(".shimmer-sweep-target").forEach((el) => {
  if (!el.querySelector(".shimmer-mask")) {
    const mask = document.createElement("div");
    mask.className = "shimmer-mask";
    el.appendChild(mask);
  }
});
```

**Timeline** — add the sweep at a position; the snippet's CONFIG-reading helper owns
the sweep's internal duration, ease, and stagger:

```js
tl.add(shimmerSweepBuild(".shimmer-sweep-target"), 1.5);
```

The parent composition owns _where_ the sweep sits on the timeline (the position arg);
the component owns _how_ it moves. Raw tween args never migrate into host code.

### 4. Lint and preview

```bash
hyperframes lint
hyperframes preview
```

### 5. Customize

- `sweep` in the snippet's `CONFIG`: `"subtle" | "standard" | "dramatic"` — drives band
  width, angle, and the helper's internal duration/ease/stagger
- `--shimmer-color`: host re-skin token — override per element or at host level
- Everything else (raw durations, eases, staggers, band geometry) is locked — changing it
  means editing the component source
