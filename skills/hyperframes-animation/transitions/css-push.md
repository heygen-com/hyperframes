## Linear / Push

### Push Slide

Both scenes move together: new pushes old out.

```js
tl.add(old, { translateX: -1920, duration: 500, ease: "inOutQuart" }, T);
tl.add(new, { translateX: [1920, 0], opacity: 1, duration: 500, ease: "inOutQuart" }, T);
```

### Vertical Push

Same as push slide but vertical.

```js
tl.add(old, { translateY: -1080, duration: 500, ease: "inOutQuart" }, T);
tl.add(new, { translateY: [1080, 0], opacity: 1, duration: 500, ease: "inOutQuart" }, T);
```

### Elastic Push

Push with overshoot bounce on the incoming scene.

```js
tl.add(old, { translateX: -1920, duration: 500, ease: "inQuart" }, T);
tl.add(new, { translateX: [1920, 30], opacity: 1, duration: 400, ease: "outQuint" }, T + 100);
tl.add(new, { translateX: -15, duration: 150, ease: "inOutSine" }, T + 500);
tl.add(new, { translateX: 0, duration: 100, ease: "outSine" }, T + 650);
```

### Squeeze

Old compresses, new expands from opposite side.

```js
tl.add(old, { scaleX: 0, transformOrigin: "left center", duration: 400, ease: "inOutQuart" }, T);
tl.add(
  new,
  { scaleX: [0, 1], transformOrigin: "right center", opacity: 1, duration: 400, ease: "inOutQuart" },
  T + 100,
);
tl.add(old, { opacity: 0, duration: 0 }, T + 500);
```
