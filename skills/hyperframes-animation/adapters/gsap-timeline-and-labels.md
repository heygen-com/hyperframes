# Timelines and Labels

HyperFrames is a seek-driven runtime. Build one paused timeline per composition, attach it to `window.__timelines["<composition-id>"]`, and let HyperFrames seek it. Never call `.play()` for render-critical motion.

## Creating a Timeline

```javascript
const tl = gsap.timeline({
  paused: true,
  defaults: { duration: 0.5, ease: "power3.out" },
});

tl.to(".a", { x: 100 }).to(".b", { y: 50 }).to(".c", { opacity: 0 });
```

Timeline options:

- **paused: true** — required in HyperFrames. The framework drives the playhead.
- **repeat**, **yoyo** — apply to the whole timeline. `repeat: -1` is forbidden; use finite counts.
- **defaults** — vars merged into every child tween. Use this instead of repeating `ease` and `duration` on every line.

## Position Parameter

The third argument to `.to()`/`.from()`/`.fromTo()` controls placement on the timeline:

| Form           | Meaning                              |
| -------------- | ------------------------------------ |
| `0`, `1.5`     | Absolute time in seconds             |
| `"+=0.5"`      | 0.5s after the end of the timeline   |
| `"-=0.2"`      | 0.2s before the end of the timeline  |
| `"intro"`      | At the `intro` label                 |
| `"intro+=0.3"` | 0.3s after the `intro` label         |
| `"<"`          | Same start as the previous tween     |
| `">"`          | Right after the previous tween ends  |
| `"<0.2"`       | 0.2s after the previous tween starts |
| `">-0.1"`      | 0.1s before the previous tween ends  |

```javascript
tl.to(".a", { x: 100 }, 0);
tl.to(".b", { y: 50 }, "<"); // same start as .a
tl.to(".c", { opacity: 0 }, "<0.2"); // 0.2s after .b starts
```

Prefer the position parameter over `delay:` — it composes naturally and survives refactors that re-order tweens.

## Labels

```javascript
tl.addLabel("intro", 0);
tl.to(".a", { x: 100 }, "intro");

tl.addLabel("outro", "+=0.5");
tl.to(".a", { opacity: 0 }, "outro");
```

Labels make a long timeline readable and let multiple tweens converge on the same beat without re-typing absolute times.

## Nesting Timelines

```javascript
const master = gsap.timeline({ paused: true });

const child = gsap.timeline();
child.to(".a", { x: 100 }).to(".b", { y: 50 });

master.add(child, 0);
```

In HyperFrames, **do not** nest sub-composition timelines into the host. Sub-compositions loaded via `data-composition-src` are seeked independently by HyperFrames from their own `data-start`. Nesting is only for grouping pieces of the _same_ composition's timeline.

## Inside Sub-Compositions: prefer `fromTo` over `from`

For entrance tweens inside a sub-composition, prefer `gsap.fromTo()` over `gsap.from()`:

```javascript
// Sub-composition entrance — survives re-seek cleanly
tl.fromTo(".title", { y: 60, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 }, 0.2);
```

Why: HyperFrames re-seeks the sub-composition every time its host clip becomes visible. `gsap.from()` snapshots the starting state at **registration time** (page load); when the playhead jumps back past `data-start`, that snapshot can desync from the actual CSS state and the element renders in the wrong position. `gsap.fromTo()` declares both endpoints explicitly, so the seek-back always produces the same start state.

In top-level (standalone) compositions either form works — there's no re-seek-through-mount cycle.

## Playback Control (debug / preview only)

```javascript
tl.play();
tl.pause();
tl.reverse();
tl.restart();
tl.time(2);
tl.progress(0.5);
tl.kill();
```

These are useful when previewing in the browser. In rendered output HyperFrames calls `seek()` internally — your timeline must produce identical state for the same time value every time it is seeked.
