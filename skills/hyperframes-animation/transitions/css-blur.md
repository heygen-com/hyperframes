## Blur

All blur transitions scale with energy. See SKILL.md "Blur Intensity by Energy" for the full table.

### Blur Through

Content becomes fully abstract before resolving. The heaviest blur transition.

**Calm (default for this type: it's inherently heavy):**

```js
tl.add(old, { filter: "blur(30px)", scale: 1.08, duration: 500, ease: "inQuad" }, T);
tl.add(old, { opacity: 0, duration: 300, ease: "inQuad" }, T + 300);
// Hold: both scenes in abstract blur state
tl.add(
  new,
  { filter: "blur(30px)", scale: 0.92, opacity: [0, 1], duration: 200, ease: "linear" },
  T + 500,
);
// Slow resolve
tl.add(new, { filter: "blur(0px)", scale: 1, duration: 700, ease: "outQuad" }, T + 700);
```

**Medium:**

```js
tl.add(old, { filter: "blur(15px)", scale: 1.05, opacity: 0, duration: 400, ease: "inCubic" }, T);
tl.add(
  new,
  {
    filter: ["blur(15px)", "blur(0px)"],
    scale: [0.95, 1],
    opacity: [0, 1],
    duration: 400,
    ease: "outCubic",
  },
  T + 200,
);
```

### Directional Blur

Blur + skew simulating motion in one direction. Scale blur and skew with energy.

**Medium (default):**

```js
tl.add(old, { filter: "blur(12px)", skewX: -8, translateX: -200, opacity: 0, duration: 400, ease: "inQuart" }, T);
tl.add(
  new,
  {
    filter: ["blur(12px)", "blur(0px)"],
    skewX: [8, 0],
    translateX: [200, 0],
    opacity: [0, 1],
    duration: 400,
    ease: "outQuart",
  },
  T + 150,
);
```

**Calm (heavier blur, gentler motion):**

```js
tl.add(old, { filter: "blur(20px)", skewX: -4, translateX: -100, opacity: 0, duration: 600, ease: "inQuad" }, T);
tl.add(
  new,
  {
    filter: ["blur(20px)", "blur(0px)"],
    skewX: [4, 0],
    translateX: [100, 0],
    opacity: [0, 1],
    duration: 600,
    ease: "outQuad",
  },
  T + 300,
);
```
