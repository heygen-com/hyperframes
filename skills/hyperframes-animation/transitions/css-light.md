## Light

### Light Leak

Multiple warm-colored overlays wash across frame. Needs: a flat warm tint layer + 2-3 bright radial gradient divs, all larger than the frame so edges are never visible.

```js
// Warm tint washes over entire frame
tl.add("#leak-warm", { opacity: 0.4, duration: 300, ease: "inQuad" }, T);
// Bright leak elements drift in
tl.add("#leak-1", { opacity: 0.9, translateX: 300, duration: 500, ease: "inOutSine" }, T + 50);
tl.add("#leak-2", { opacity: 0.8, translateX: 200, duration: 600, ease: "inOutSine" }, T + 100);
// Peak warmth then swap
tl.add("#leak-warm", { opacity: 0.6, duration: 150, ease: "inCubic" }, T + 350);
tl.add(old, { opacity: 0, duration: 0 }, T + 450);
tl.add(new, { opacity: 1, duration: 0 }, T + 450);
// Leak fades
tl.add("#leak-warm", { opacity: 0, duration: 400, ease: "outCubic" }, T + 500);
tl.add("#leak-1", { opacity: 0, translateX: 600, duration: 350, ease: "outQuad" }, T + 500);
```

### Overexposure Burn

Scene progressively blows out to white using CSS `filter: brightness()`, then white overlay fades in. Swap at peak white. White recedes to reveal new scene.

```js
tl.add(old, { filter: "brightness(1.5)", scale: 1.03, duration: 200, ease: "inQuad" }, T);
tl.add(old, { filter: "brightness(3)", scale: 1.06, duration: 200, ease: "inCubic" }, T + 200);
tl.add("#flash-overlay", { opacity: 0.5, duration: 250, ease: "inQuad" }, T + 150);
tl.add("#flash-overlay", { opacity: 1, duration: 150, ease: "inCubic" }, T + 400);
tl.add(old, { opacity: 0, filter: "brightness(1)", scale: 1, duration: 0 }, T + 550);
tl.add(new, { opacity: 1, duration: 0 }, T + 550);
tl.add("#flash-overlay", { opacity: 0, duration: 350, ease: "outCubic" }, T + 550);
```

### Film Burn

Staggered warm overlays (amber, orange, red) bleed from one edge. Each overlay is a large radial gradient div at high z-index.

```js
tl.add("#burn-a", { opacity: 1, translateX: -300, duration: 400, ease: "inQuad" }, T);
tl.add("#burn-b", { opacity: 1, translateX: -500, duration: 500, ease: "inQuad" }, T + 50);
tl.add("#burn-c", { opacity: 1, translateX: -200, duration: 450, ease: "inQuad" }, T + 100);
tl.add(old, { opacity: 0, duration: 0 }, T + 350);
tl.add(new, { opacity: 1, duration: 0 }, T + 350);
tl.add("#burn-a", { opacity: 0, duration: 300, ease: "outCubic" }, T + 450);
tl.add("#burn-b", { opacity: 0, duration: 300, ease: "outCubic" }, T + 500);
tl.add("#burn-c", { opacity: 0, duration: 300, ease: "outCubic" }, T + 550);
```
