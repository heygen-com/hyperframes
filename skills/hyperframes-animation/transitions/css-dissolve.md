## Dissolve

### Crossfade

Simple opacity swap. The baseline.

```js
tl.add(old, { opacity: 0, duration: 500, ease: "inOutCubic" }, T);
tl.add(new, { opacity: [0, 1], duration: 500, ease: "inOutCubic" }, T);
```

### Blur Crossfade

Dissolve with blur + scale shift. **Scale blur amount by energy**: see SKILL.md "Blur Intensity by Energy" section. The examples below show the medium (default) version. For calm compositions, increase to 20-30px with a 0.3-0.5s hold at peak blur. For high-energy, decrease to 3-6px with no hold.

**Medium (default):**

```js
tl.add(old, { filter: "blur(10px)", scale: 1.03, opacity: 0, duration: 500, ease: "inOutCubic" }, T);
tl.add(
  new,
  {
    filter: ["blur(10px)", "blur(0px)"],
    scale: [0.97, 1],
    opacity: [0, 1],
    duration: 500,
    ease: "inOutCubic",
  },
  T + 100,
);
```

**Calm (wellness, luxury): heavy blur, holds at abstract color:**

```js
tl.add(old, { filter: "blur(25px)", scale: 1.05, duration: 600, ease: "inQuad" }, T);
tl.add(old, { opacity: 0, duration: 400, ease: "inQuad" }, T + 400);
tl.add(new, { filter: "blur(25px)", scale: 0.95, opacity: [0, 1], duration: 300, ease: "inOutQuad" }, T + 500);
tl.add(new, { filter: "blur(0px)", scale: 1, duration: 600, ease: "outQuad" }, T + 800);
```

### Focus Pull

Outgoing slowly blurs while incoming fades in sharp. Depth-of-field feel. **Scale blur amount and hold duration by energy.**

**Medium:**

```js
tl.add(old, { filter: "blur(15px)", duration: 500, ease: "inQuad" }, T);
tl.add(old, { opacity: 0, duration: 300, ease: "inCubic" }, T + 250);
tl.add(new, { opacity: [0, 1], duration: 300, ease: "outCubic" }, T + 250);
```

**Calm: slow rack focus with long hold at peak defocus:**

```js
tl.add(old, { filter: "blur(30px)", duration: 800, ease: "inQuad" }, T);
tl.add(old, { opacity: 0, duration: 500, ease: "inQuad" }, T + 600);
tl.add(new, { opacity: [0, 1], filter: "blur(20px)", duration: 300, ease: "inOutQuad" }, T + 700);
tl.add(new, { filter: "blur(0px)", duration: 600, ease: "outQuad" }, T + 1000);
```

### Color Dip

Fade to solid color, hold, fade up new scene.

```js
tl.add(old, { opacity: 0, duration: 200, ease: "inCubic" }, T);
// Background color shows through
tl.add(new, { opacity: [0, 1], duration: 200, ease: "outCubic" }, T + 250);
```
