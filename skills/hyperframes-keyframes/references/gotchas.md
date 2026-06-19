# Gotchas & anti-patterns

The failure modes that actually bite, each with the fix.

## Coordinates

- **x/y are offsets, not absolute coordinates.** `{x:0,y:0}` is the element's CSS layout spot, not the canvas origin. The #1 mistake is treating them as absolute and authoring a path that's translated off where you expect. Author deltas from the element's home.
- **Center your tracer in CSS first.** If you're tracing a shape, put the element at the visual center via CSS (e.g. `left:50%;top:50%;margin:-h -w`), then author x/y as offsets around `0,0`. Keep offsets within the visible canvas (for 1080² centered, roughly ±480).

## Reading the surface

- **The ASCII autoscales each axis independently** — proportions read distorted (tall-narrow → wide-flat). Topology (order, crossings, bends) is reliable; aspect is not. Trust the printed `x …` / `y …` ranges and `--json`, not the visual width/height. Don't re-shape a path that only _looks_ wrong because of the grid.
- **Vertical resolution is the floor (~11 rows).** Fine detail can't render. If edits stop changing the picture but the numbers differ, you've hit the floor — verify against `--json`, don't keep nudging.
- **Straight segments ≠ eased motion.** The grid draws straight lines between stops; a non-linear `ease` curves the real motion. Use `ease: "none"` when you want the preview to match the render exactly; otherwise add intermediate keyframes for path fidelity and keep ease for feel.

## Shape / strokes

- **One continuous line can't make holes or gaps.** If the surface shows a connector across a gap you didn't want (the line from a `?` stem to its dot, or between two letters), the fix is **multi-stroke** (`multi-stroke.md`) — separate tweens with a `set()` pen-up — not more keyframes.
- **A trace only forms with ≥2 strokes on one element.** A single stroke stays a normal per-tween block; that's expected.

## Iterating

- **Don't thrash.** Quality plateaus by ~5 rounds; beyond that, more iterations tend to over-edit a good path. Stop when faithful, or ask the user. (See `SKILL.md` → Stop condition.)
- **Use the formula when one exists.** Heart, ∞, star, spiral, circle — author from the parametric form and verify once. Iterating a formula shape is wasted effort.
- **Keep the target in view.** When tracing a known shape (logo/glyph/icon), re-check the path against the reference each round — reasoning from the actual target beats reasoning from memory.

## Parser / runtime

- **Studio holds are internal.** `set("#el", { …, data: "hf-hold" })` is a position-hold the Studio injects before a keyframed position tween; it's filtered from the surface. Never author or hand-edit it.
- **Dynamic tweens don't fully resolve.** Computed selectors or data-driven keyframes can't be statically read and surface with fewer details. If you want a tween to be editable here, author literal `keyframes: { … }` with literal numbers.
- **GSAP only.** Lottie / Three.js / CSS / WAAPI motion doesn't surface — use the matching `hyperframes-animation` adapter.

## Workflow

- **This command never writes.** It reads and draws; every edit is yours to make in source. Re-run to verify.
- **Pair it.** `keyframes` for the path, `inspect` for layout/overflow across the timeline, `render` to ship. Don't skip `inspect` — a path can be right while the element clips.
