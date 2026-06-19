# Editing keyframes in source

Edits go in the composition's `<script>`. The surface is read-only; you change the GSAP call, then re-run `keyframes` to verify.

## Coordinate model

`x`/`y` are the element's **offset from its CSS layout position** (a GSAP translate), in pixels: `{x:0,y:0}` is wherever the element sits by its CSS; `+x` right, `+y` down. They are **not** absolute canvas coordinates. Author offsets relative to the element's home, and read the surface's `x …` / `y …` ranges the same way.

## Object-form keyframes (preferred)

Each value is an offset; percentages are tween-relative and must ascend.

```js
tl.to(
  "#hero",
  {
    keyframes: {
      "0%": { x: 0, y: 0 },
      "50%": { x: 120, y: -80 },
      "100%": { x: 240, y: 0 },
    },
    duration: 2,
    ease: "power1.inOut",
  },
  1.0,
); // position arg = absolute start on the timeline
```

## The four edits

- **Move a keyframe** — change its `x`/`y` (or any prop) at that `%`.
- **Add a keyframe** — insert a new `"P%": { x, y }` entry, keeping ascending order. If the tween is a flat `to("#el", { x })`, convert it to keyframes first (below).
- **Remove a keyframe** — delete its `"P%"` entry. If fewer than two stops remain, collapse back to a flat tween.
- **Retime** — change the tween's `duration` or its position argument. The `@start` shifts; the `%`s stay put (they're relative).

## Convert a flat tween into keyframes

A flat `to`/`from` animates between the element's rest pose and one set of values. To shape its path, give it explicit stops:

```js
// before — a straight slide, no shapeable path
tl.to("#el", { x: 240, duration: 2 });

// after — an editable path
tl.to("#el", {
  keyframes: { "0%": { x: 0, y: 0 }, "50%": { x: 120, y: -80 }, "100%": { x: 240, y: 0 } },
  duration: 2,
});
```

## Single-axis keyframes carry forward

If a keyframe sets only one axis, GSAP holds the other at its last value — and the surface's `path` does the same, so it stays continuous. Set both axes when you want an explicit point; set one when you intend "hold the other."

## Easing

`ease` shapes timing, not the spatial path. `--shot` samples at equal time steps, so an eased tween shows as **uneven ghost spacing** — bunched where it's slow, spread where it's fast — i.e. you see the ease directly. If the _spatial_ path needs more curve, add keyframes; reserve ease for feel.

## Verify

After each edit, `keyframes --shot out.png` and check the PNG before `inspect` / `render`. See the stop condition in `SKILL.md`: usually ≤5 rounds, then ship or ask.
