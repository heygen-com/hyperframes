# Builder contract - composition rules (detail behind agents/builder.md)

## Root must be sized

Root `#stage` (`data-composition-id`) needs `position: relative; width: <W>px; height: <H>px`. Without a resolved height, flex children collapse to ~0 and content piles into the top-left - and `lint`/`inspect` won't catch it.

## Layout before animation

1. Identify the **hero frame** (the moment most elements are visible) -> build THAT in static CSS first, no animation code.
2. `.scene-content` fills the scene with padding, not offsets:
   ```css
   display: flex;
   flex-direction: column;
   justify-content: center;
   width: 100%;
   height: 100%;
   padding: 120px 160px;
   gap: 24px;
   box-sizing: border-box;
   ```
   Never `position:absolute; top:Npx` on a content container (it overflows). Reserve absolute for decoratives. Keep ≥80px padding (title-safe margin).
3. **Entrances**: `tl.add()` with from-to arrays FROM offscreen/invisible TO the CSS position. The CSS position is ground truth; the tween is the journey to it.
4. **Exits**: only the final scene animates elements out; between scenes the transition IS the exit.

## Timeline / clip contract

- ONE `anime.createTimeline({ autoplay: false })`; register it with `hyperframesAnime.register("<id>", tl)`; `tl.seek(0)`; never `tl.play()`.
- Timed elements: `class="clip"` + `data-start`/`data-duration`/`data-track-index` + a stable `id`. Timeline-driven groups inside one full-duration clip don't each need timing attrs.
- Deterministic only, no `Date.now()` / `Math.random()` / network. Count-ups tween a proxy object via `onUpdate` (seek-safe), never a wall-clock counter.

## Correctness

- **Seek-safe reveal of delayed elements**: add a zero-duration hidden state once, then reveal with `tl.add(el, { opacity: 1, visibility: "visible", ... }, startMs)` at the entrance. **Do NOT** gate via a visible set plus an opacity-from tween, under a paused/seeked render the element can stay invisible _forever_ (browser-play hides this; seek-capture exposes it). _(Eval finding.)_
- **Count-ups** tween a proxy via `onUpdate`; they only render when the host advances the timeline with events enabled. A suppressed seek freezes them at 0, the HF render host must seek with events on. _(Eval finding.)_
- Clamp at tween bounds; don't let a spring overshoot past a held value.
- Allowed eases: `inQuad` / `outQuad` / `inOutQuad`, `inCubic` / `outCubic` / `inOutCubic`, `inQuart` / `outQuart` / `inOutQuart`, `inQuint` / `outQuint` / `inOutQuint`, `inBack(...)`, `outBack(...)`, `inOutBack(...)`, `inBounce` / `outBounce` / `inOutBounce`, `inCirc` / `outCirc` / `inOutCirc`, `inElastic(...)`, `outElastic(...)`, `inOutElastic(...)`, `inExpo` / `outExpo` / `inOutExpo`, `inSine` / `outSine` / `inOutSine`, `steps(n)`, and `linear`.
- One motif per scene. Run `hyperframes inspect`; mark intentional overflow `data-layout-allow-overflow="true"`.
- **Palette discipline**: define all colors in one `palette` object / CSS custom properties - no inline hex scattered through the markup (for `asset-fusion`, eyedropper the palette from the asset).
