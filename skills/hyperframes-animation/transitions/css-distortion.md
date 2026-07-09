## Distortion

### Glitch

RGB-tinted overlays (NOT multiply blend - use normal blending at 35% opacity) jitter with large offsets. Scene itself also jitters.

```js
tl.add("#glitch-r", { opacity: 1, translateX: 40, translateY: -8, duration: 0 }, T);
tl.add("#glitch-g", { opacity: 1, translateX: -30, translateY: 12, duration: 0 }, T);
tl.add("#glitch-b", { opacity: 1, translateX: 15, translateY: -20, duration: 0 }, T);
tl.add(old, { translateX: -15, duration: 0 }, T);
// 6 jitter frames at 0.03s intervals with big offsets (±30-60px)
// ... swap and clear at T + 200
```

### Chromatic Aberration

RGB overlays start aligned then spread apart (±80px), scene fades, converge on new scene.

```js
tl.add("#glitch-r", { opacity: 0.6, translateX: 0, duration: 0 }, T);
tl.add("#glitch-g", { opacity: 0.6, translateX: 0, duration: 0 }, T);
tl.add("#glitch-b", { opacity: 0.6, translateX: 0, duration: 0 }, T);
tl.add("#glitch-r", { translateX: -80, opacity: 0.8, duration: 300, ease: "inCubic" }, T);
tl.add("#glitch-b", { translateX: 80, opacity: 0.8, duration: 300, ease: "inCubic" }, T);
tl.add("#glitch-g", { translateY: 30, duration: 300, ease: "inCubic" }, T);
// Swap at T + 300, converge back at T + 300
```

### Ripple

Rapid oscillation (±30px) + scale distortion (0.97-1.03) + increasing blur. Swap at peak distortion.

```js
tl.add(old, { translateX: 30, scale: 1.02, duration: 40, ease: "linear" }, T);
tl.add(
  old,
  { translateX: -25, scale: 0.98, filter: "blur(4px)", duration: 40, ease: "linear" },
  T + 40,
);
// ... more oscillations with increasing blur
// Swap at peak, incoming stabilizes with decreasing wobble
```

### VHS Tape

Clone scene into 20 horizontal strips (each 54px, clip-path'd). Each strip shifts x independently with seeded pseudo-random offsets at per-bar random intervals. Add red+blue chromatic offset copies on each strip (z-index above main, 35% opacity). Make strips wider than frame (2020px at left:-50px) so edges never show.

See SKILL.md for clone-based implementation pattern.
