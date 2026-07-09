## Radial / Shape

### Circle Iris

Expanding circle from center reveals new scene.

```js
tl.add(new, { opacity: 1, duration: 0 }, T);
tl.add(new, { clipPath: ["circle(0% at 50% 50%)", "circle(75% at 50% 50%)"], duration: 500, ease: "outCubic" }, T);
tl.add(old, { opacity: 0, duration: 0 }, T + 500);
```

### Diamond Iris

Expanding diamond shape from center.

```js
tl.add(new, { opacity: 1, duration: 0 }, T);
tl.add(
  new,
  {
    clipPath: [
      "polygon(50% 50%, 50% 50%, 50% 50%, 50% 50%)",
      "polygon(50% -20%, 120% 50%, 50% 120%, -20% 50%)",
    ],
    duration: 500,
    ease: "outCubic",
  },
  T,
);
tl.add(old, { opacity: 0, duration: 0 }, T + 500);
```

### Diagonal Split

Old scene shrinks to a triangle in one corner.

```js
tl.add(new, { opacity: 1, zIndex: 1, duration: 0 }, T);
tl.add(old, { zIndex: 10, clipPath: "polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)", duration: 0 }, T);
tl.add(old, { clipPath: "polygon(60% 0%, 100% 0%, 100% 40%, 60% 0%)", duration: 500, ease: "inOutQuart" }, T);
tl.add(old, { opacity: 0, zIndex: "auto", clipPath: "none", duration: 0 }, T + 500);
tl.add(new, { zIndex: "auto", duration: 0 }, T + 500);
```
