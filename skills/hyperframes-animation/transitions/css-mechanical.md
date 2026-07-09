## Mechanical

### Shutter

Two full-screen halves close from top and bottom, meet in the middle. Swap while closed. Open again.

```js
tl.add("#shutter-top", { translateY: 0, duration: 250, ease: "inQuart" }, T);
tl.add("#shutter-bot", { translateY: 0, duration: 250, ease: "inQuart" }, T);
tl.add(old, { opacity: 0, duration: 0 }, T + 250);
tl.add(new, { opacity: 1, duration: 0 }, T + 250);
tl.add("#shutter-top", { translateY: -540, duration: 250, ease: "outQuart" }, T + 300);
tl.add("#shutter-bot", { translateY: 540, duration: 250, ease: "outQuart" }, T + 300);
```

### Clock Wipe

Radial polygon sweep stepping through quadrants. Use 9-point polygon with intermediate edge positions for smooth sweep.

```js
tl.add(new, { opacity: 1, zIndex: 10, duration: 0 }, T);
var d = 100; // duration per quadrant in milliseconds
tl.add(new, { clipPath: "polygon(50% 50%, 50% 0%, 50% 0%, 50% 0%, 50% 0%, 50% 0%, 50% 0%, 50% 0%, 50% 0%)", duration: 0 }, T);
tl.add(new, { clipPath: "polygon(50% 50%, 50% 0%, 100% 0%, 100% 50%, 100% 50%, 100% 50%, 100% 50%, 100% 50%, 100% 50%)", duration: d, ease: "linear" }, T);
tl.add(new, { clipPath: "polygon(50% 50%, 50% 0%, 100% 0%, 100% 50%, 100% 100%, 50% 100%, 50% 100%, 50% 100%, 50% 100%)", duration: d, ease: "linear" }, T + d);
tl.add(new, { clipPath: "polygon(50% 50%, 50% 0%, 100% 0%, 100% 50%, 100% 100%, 50% 100%, 0% 100%, 0% 50%, 0% 50%)", duration: d, ease: "linear" }, T + d*2);
tl.add(new, { clipPath: "polygon(50% 50%, 50% 0%, 100% 0%, 100% 50%, 100% 100%, 50% 100%, 0% 100%, 0% 50%, 0% 0%)", duration: d, ease: "linear" }, T + d*3);
tl.add(new, { clipPath: "none", zIndex: "auto", duration: 0 }, T + d*4 + 20);
tl.add(old, { opacity: 0, zIndex: "auto", duration: 0 }, T + d*4 + 20);
```
