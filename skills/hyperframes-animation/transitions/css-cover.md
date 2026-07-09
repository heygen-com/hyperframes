## Cover

### Staggered Color Blocks

Full-screen (1920x1080) colored divs slide across staggered. Scene swaps while covered.

**2-block** (standard):

```js
tl.add("#wipe-a", { translateX: -1920, duration: 0 }, T - 10);
tl.add("#wipe-b", { translateX: -1920, duration: 0 }, T - 10);
tl.add("#wipe-a", { translateX: 0, duration: 250, ease: "inOutQuart" }, T);
tl.add("#wipe-b", { translateX: 0, duration: 250, ease: "inOutQuart" }, T + 60);
tl.add(old, { opacity: 0, duration: 0 }, T + 200);
tl.add(new, { opacity: 1, duration: 0 }, T + 200);
tl.add("#wipe-a", { translateX: 1920, duration: 250, ease: "inOutQuart" }, T + 280);
tl.add("#wipe-b", { translateX: 1920, duration: 250, ease: "inOutQuart" }, T + 340);
```

**5-block** (dense variant): same pattern with 5 blocks at 0.04s stagger. Use composition palette colors.

### Horizontal Blinds

Full-width strips slide across staggered. Each strip: `width: 1920px; height: Xpx`.

**6 strips** (180px each): `0.03s` stagger
**12 strips** (90px each): `0.018s` stagger

```js
for (var i = 0; i < N; i++) {
  tl.add("#blind-h-" + i, { translateX: -1920, duration: 0 }, T - 10);
  tl.add("#blind-h-" + i, { translateX: [-1920, 0], duration: 200, ease: "inOutQuart" }, T + i * stagger);
}
tl.add(old, { opacity: 0, duration: 0 }, T + coverTime);
tl.add(new, { opacity: 1, duration: 0 }, T + coverTime);
for (var i = 0; i < N; i++) {
  tl.add("#blind-h-" + i, { translateX: 1920, duration: 200, ease: "inOutQuart" }, T + exitStart + i * stagger);
}
```

### Vertical Blinds

Same as horizontal but strips are tall and narrow, moving on Y axis.
