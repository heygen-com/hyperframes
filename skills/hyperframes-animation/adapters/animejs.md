---
name: hyperframes-animejs
description: Anime.js adapter patterns for HyperFrames. Use when writing Anime.js animations or timelines inside HyperFrames compositions, registering animations on window.__hfAnime, making Anime.js seek-driven and deterministic, or translating Anime.js examples into render-safe HyperFrames HTML.
---

# Anime.js for HyperFrames

HyperFrames can seek Anime.js instances through its `animejs` runtime adapter. The composition owns the animation objects; HyperFrames owns the clock.

**This page targets v4 (examples pinned to 4.5.0, MIT).** v4 is a hard break from v3 — there is no callable `anime()`, `easing:` is now `ease:`, and ease names lost their `ease` prefix. Writing v3 from memory produces a composition that throws or silently animates nothing.

The repo's own producer fixtures pin `animejs@4.0.2/lib/anime.iife.min.js`, which still resolves — but that build predates `splitText` / `scrambleText` / `createSeededRandom` / `createLayout` used below, and 4.1+ moved the bundles to `dist/bundles/`, so a version bump needs the path changed too.

## Contract

- Create animations or timelines synchronously during composition initialization.
- Set `autoplay: false` so Anime.js does not advance on its own clock.
- Register every returned animation or timeline on `window.__hfAnime` — **explicitly. There is no working auto-discovery on v4** (see Avoid).
- Use finite durations and loop counts.
- Avoid callbacks that mutate DOM based on wall-clock time, network state, or unseeded randomness.

The adapter seeks every registered instance with `instance.seek(timeMs)`, where `timeMs` is HyperFrames time **in milliseconds** (`ctx.time` seconds × 1000). It also calls `pause()` and `play()` on each instance; anything exposing those three methods works, whatever created it.

## Loading v4

```html
<!-- UMD: the global `anime` is a NAMESPACE OBJECT, not a function -->
<script src="https://cdn.jsdelivr.net/npm/animejs@4.5.0/dist/bundles/anime.umd.min.js"></script>
```

`anime.animate(...)`, `anime.createTimeline(...)`, `anime.utils.*`, `anime.svg.*`, `anime.stagger(...)`. **Calling `anime(...)` is a TypeError** — every v4 build (UMD and IIFE alike) assigns a namespace object to the global, so v3's `anime({ targets })` form cannot work no matter which v4 file you load.

## Basic Pattern

```html
<script>
  const anim = anime.animate(".mark", {
    x: 280, // v4 shorthand for translateX
    rotate: "1turn",
    opacity: [0, 1],
    duration: 1200,
    ease: "outExpo", // NOT easing: "easeOutExpo"
    autoplay: false,
  });

  window.__hfAnime = window.__hfAnime || [];
  window.__hfAnime.push(anim);
</script>
```

## Timeline Pattern

`createTimeline` replaces `anime.timeline`, and `add()` takes **targets as its first argument** — `add(targets, parameters, position)`:

```html
<script>
  const tl = anime.createTimeline({
    autoplay: false,
    defaults: { ease: "outCubic" }, // per-timeline defaults, not a bare `easing`
  });

  tl.add(".title", { y: [40, 0], opacity: [0, 1], duration: 650 });
  tl.add(".accent", { scaleX: [0, 1], duration: 450 }, 250); // 250 = time position

  window.__hfAnime = window.__hfAnime || [];
  window.__hfAnime.push(tl);
</script>
```

Position accepts a number, a label, `"+=250"` / `"-=100"`, `"<"` (previous **end**) and `"<<"` (previous **start**).

## Module Builds

The adapter does not care how the instance was created — only that it exposes `seek()`, `pause()`, and `play()`:

```html
<script type="module">
  import { animate } from "https://cdn.jsdelivr.net/npm/animejs@4.5.0/+esm";

  const anim = animate(".chip", { x: "18rem", duration: 900, autoplay: false });

  window.__hfAnime = window.__hfAnime || [];
  window.__hfAnime.push(anim);
</script>
```

## Determinism

v4 ships `createSeededRandom(seed)` — use it instead of `Math.random()` when a composition needs scatter/jitter, so the same frame renders the same on every pass:

```js
const rnd = anime.createSeededRandom(1337);
anime.animate(".dot", { y: () => -40 * rnd(), duration: 800, autoplay: false });
```

`anime.utils.random()` / `randomPick()` / `shuffle()` are **not** seeded — they break frame-to-frame reproducibility.

## Good Uses

- Small SVG and DOM flourishes where Anime.js syntax is compact.
- Free `splitText` / `scrambleText` (Motion puts these behind Motion+; GSAP SplitText is the other free option).
- `svg.createDrawable` / `svg.morphTo` / `svg.createMotionPath` line-draw and path work.
- Multiple independent micro-animations pushed into the same registry.

Use GSAP for complex scene sequencing unless the user specifically asks for Anime.js. GSAP is still the primary HyperFrames authoring path.

## Avoid

- Leaving `autoplay` at the Anime.js default.
- **Relying on the adapter's `anime.running` auto-discovery — it cannot work on v4.** `running` is not among v4.5.0's exports (verified against the published bundle), so `discover()` returns immediately and any instance you did not `push()` is never seeked. Explicit registration is mandatory, not a nicety.
- `autoplay: onScroll(...)` — there is no scroll in a headless seek render, so the animation would never advance. Drive it off composition time instead.
- `waapi.animate()` for anything the adapter must seek — the adapter seeks via `.seek()`, and whether WAAPI-backed instances honor it is **unverified**. Use the JS engine (`animate`) for rendered compositions; `waapi` is an off-main-thread optimization for live pages.
- `createDraggable`, and any pointer-driven `createAnimatable` loop — input does not exist at render time.
- Infinite loops. Compute a finite repeat count from the composition duration (v4 `loop` counts **repeats**: `loop: 1` plays twice).
- Building animations in timers, promises, event handlers, or after async asset loads.

## Validation

After editing a composition that uses Anime.js:

```bash
npx hyperframes lint
npx hyperframes validate
```

## Credits And References

- HyperFrames adapter source: `packages/core/src/runtime/adapters/animejs.ts`.
- Anime.js v4 docs: https://animejs.com/documentation/
- v3 → v4 migration (not on animejs.com): https://github.com/juliangarnier/anime/wiki/Migrating-from-v3-to-v4
