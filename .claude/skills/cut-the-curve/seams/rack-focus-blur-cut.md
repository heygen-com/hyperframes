# Rack-Focus Blur-Cut — the visible cut

The one variant where the cut is SEEN: a defocus blur SPIKE hides a single-frame hard
swap — a handheld-DSLR focus-pull. Use as an occasional flourish for a state swap of the
SAME surface within one visual theme; never the default boundary.

Differences from the others: outgoing stays FULLY OPAQUE until the cut (the blur hides
the swap — no early fade); eases `power2.in` / `power2.out` (soft optics, not momentum).

Rules:

- Fire only at a narrative beat, ≤ once per ~8s; never mid-caption or during a hold.
- Cut at PEAK blur (≥6px; peak 8–12px, ≤16–18px max) — swapping on the way up shows the cut.
- A subtle scale (~1.06 lens-breathing) sells it as optics.
- Same direction on both sides — the vector law still holds. Entry ≥ exit duration.
- Blur the wrapper; never blur + opacity in one tween on one element (headless
  compositing bug); never blur a `<video>` directly (wrap it).

## JS

For a Z dolly, drop the x-offset and use scale `0.92 →` / `→ 1.08`.

```js
var T = /* transition start */;
// Phase 1: outgoing pans + blurs, held fully opaque
tl.to("#scene-out", { x: -80, scale: 1.06, filter: "blur(12px)", duration: 0.3, ease: "power2.in" }, T);
// Phase 2: hard cut at peak blur
tl.set("#scene-out", { opacity: 0 }, T + 0.3);
tl.fromTo("#scene-in",
  { opacity: 1, x: 80, scale: 1.06, filter: "blur(12px)" },
  { x: 0, scale: 1, filter: "blur(0px)", duration: 0.35, ease: "power2.out" },
  T + 0.3);
```

## Anti-patterns

| Don't                                      | Instead                                          |
| ------------------------------------------ | ------------------------------------------------ |
| Using this as the default boundary         | Cut-the-curve is the default; this is a flourish |
| Swapping before peak blur                  | Cut AT peak (≥6px)                               |
| Early fade on the outgoing side            | Fully opaque until the cut — the blur hides it   |
| Blur + opacity in one tween on one element | Separate tweens (headless compositing bug)       |
