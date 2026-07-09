## Scale / Zoom

### Zoom Through

Old zooms past camera + blurs, new zooms in from behind.

```js
tl.add(old, { scale: 2.5, opacity: 0, filter: "blur(8px)", duration: 400, ease: "inQuart" }, T);
tl.add(
  new,
  {
    scale: [0.5, 1],
    opacity: [0, 1],
    filter: ["blur(8px)", "blur(0px)"],
    duration: 400,
    ease: "outQuart",
  },
  T + 150,
);
```

### Zoom Out

Old shrinks away, new was behind it. Needs z-index management.

```js
tl.add(new, { opacity: 1, zIndex: 1, duration: 0 }, T);
tl.add(old, { zIndex: 10, transformOrigin: "50% 50%", duration: 0 }, T);
tl.add(old, { scale: 0.3, opacity: 0, duration: 400, ease: "inQuart" }, T);
tl.add(old, { zIndex: "auto", duration: 0 }, T + 400);
tl.add(new, { zIndex: "auto", duration: 0 }, T + 400);
```
