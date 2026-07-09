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

**HTML**: wrap target elements:

```html
<div class="shimmer-sweep-target" style="--shimmer-color: rgba(255, 255, 255, 0.5)">
  <h1 class="title">AI-Powered Video</h1>
</div>
```

**CSS**: paste the `.shimmer-sweep-target` and `.shimmer-mask` rules from the snippet.

**JS**: paste the auto-injection script before timeline code:

```js
document.querySelectorAll(".shimmer-sweep-target").forEach((el) => {
  if (!el.querySelector(".shimmer-mask")) {
    const mask = document.createElement("div");
    mask.className = "shimmer-mask";
    el.appendChild(mask);
  }
});
```

**Timeline**: add the sweep to the host anime.js timeline:

```js
tl.add(
  ".shimmer-sweep-target",
  {
    "--shimmer-pos": [
      { to: "-20%", duration: 0, ease: "linear" },
      { to: "120%", duration: 1200, ease: "inOutCubic" },
    ],
    delay: anime.stagger(150),
  },
  1500,
);
```

The CSS custom property is the animated channel. `duration`, `delay`, and the `1500` timeline position are milliseconds.

> **Non-default GSAP adapter path.** If the host composition deliberately uses GSAP, the same sweep can be wired into its paused GSAP timeline with `fromTo`, `duration: 1.2`, `ease: "power2.inOut"`, `stagger: 0.15`, and position `1.5`.

### 4. Lint and preview

```bash
hyperframes lint
hyperframes preview
```

### 5. Customize

- `--shimmer-color`: highlight color per element
- `--shimmer-width`: light band width, default 20%
- `--shimmer-angle`: sweep direction, default 120deg
- Timeline `duration`, `ease`, `stagger`: control speed and feel
