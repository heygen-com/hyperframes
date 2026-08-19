# Builder contract — composition rules (detail behind agents/builder.md)

## Root must be sized

Root `#stage` (`data-composition-id`) needs `position: relative; width: <W>px; height: <H>px`. Without a resolved height, flex children collapse to ~0 and content piles into the top-left. Automated gates may miss it, so inspect proof snapshots.

## Layout before animation

1. Identify the **hero frame** (the moment most elements are visible) → build THAT in static CSS first, no GSAP.
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
3. **Entrances**: use `gsap.from()` only for a non-clip element active from `t=0`. Inside `.clip`, in sub-compositions, and for later entrances, use explicit `fromTo()`. The CSS position is ground truth; the tween is the journey to it.
4. **Exits**: only the final scene animates elements out; between scenes the transition IS the exit.

## Timeline / clip contract

- ONE `gsap.timeline({paused:true})` on `window.__timelines["<id>"]`; `tl.seek(0)`; never `tl.play()`.
- Timed elements: `class="clip"` + `data-start`/`data-duration`/`data-track-index` + a stable `id`. Timeline-driven groups inside one full-duration clip don't each need timing attrs.
- Deterministic only — no `Date.now()` / `Math.random()` / network. Count-ups tween a proxy object via `onUpdate` (seek-safe), never a wall-clock counter.

## Correctness

- **Seek-safe reveal of delayed elements**: on a non-clip element or wrapper inside a clip, use one registered timeline `fromTo()` with an explicit `{ autoAlpha: 0 }` start and `{ autoAlpha: 1, ... }` end. Do not page-load `gsap.set()` a later `.clip`, and never target `.clip` visibility; the framework owns its lifecycle. _(Eval finding.)_
- **Count-ups** tween a proxy via `onUpdate`; they only render when the host advances the timeline **with events enabled** (`tl.time()` / non-suppressed seek). A bare `seek(t, true)` freezes them at 0 — the HF render host must seek with events on. _(Eval finding.)_
- Clamp at tween bounds; don't let a spring overshoot past a held value.
- Allowed eases: `power1–4`, `back`, `bounce`, `circ`, `elastic`, `expo`, `sine` (`.in/.out/.inOut`).
- One motif per scene. Run `hyperframes check`; mark intentional overflow `data-layout-allow-overflow="true"`.
- **Palette discipline**: define all colors in one `palette` object / CSS custom properties — no inline hex scattered through the markup (for `asset-fusion`, eyedropper the palette from the asset).
