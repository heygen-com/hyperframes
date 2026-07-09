## Other

### Gravity Drop

Old scene falls down with slight rotation. New scene was behind it. Needs z-index.

```js
tl.add(new, { opacity: 1, zIndex: 1, duration: 0 }, T);
tl.add(old, { zIndex: 10, duration: 0 }, T);
tl.add(old, { translateY: 1200, rotate: 4, duration: 500, ease: "inQuart" }, T);
tl.add(old, { opacity: 0, zIndex: "auto", duration: 0 }, T + 500);
tl.add(new, { zIndex: "auto", duration: 0 }, T + 500);
```

### Morph Circle

A circle scales up from center to fill frame (becoming the new scene's background color). New scene content fades in on top.

```js
tl.add("#morph-circle", { background: newBgColor, opacity: 1, scale: 0, duration: 0 }, T);
tl.add("#morph-circle", { scale: 30, duration: 500, ease: "inQuart" }, T);
tl.add(old, { opacity: 0, duration: 0 }, T + 400);
tl.add(new, { opacity: 1, duration: 0 }, T + 400);
tl.add("#morph-circle", { opacity: 0, duration: 150, ease: "outCubic" }, T + 500);
```
