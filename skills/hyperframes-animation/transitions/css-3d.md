## 3D

### 3D Card Flip

180° Y-axis rotation. Requires CSS: `backface-visibility: hidden; transform-style: preserve-3d;` on both scene-inners. Parent needs `perspective: 1200px`.

```js
tl.add(new, { rotateY: -180, opacity: 1, duration: 0 }, T);
tl.add(old, { rotateY: 180, duration: 600, ease: "inOutCubic" }, T);
tl.add(new, { rotateY: 0, duration: 600, ease: "inOutCubic" }, T);
tl.add(old, { opacity: 0, duration: 0 }, T + 600);
```
