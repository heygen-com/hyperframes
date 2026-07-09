# asset-fusion - category module (search-driven · the net-new IP)

**A real asset's geometry _becomes_ the chart** - RWA diegetic fusion (the straw becomes a gauge; a glass's liquid becomes a pie). Not in any catalog; the genuinely net-new capability. ~5–8s.

## Source (Step 2)

Search or generate one **hero asset** with strong geometric affordance. `asset_needs`: `{ kind: image, query|generate, treatment: cutout|none }`. Freeze it project-local.

## Plan (Director Part 2) - the fusion logic

1. Classify the **data type** (temporal / quantitative / proportion / spatial).
2. Read the asset's **geometric affordance** - linearity → timeline/gauge · volume/texture → pie · height → bar · container → exploded view.
3. `element_positions`: **GROUND with the locate protocol - never eyeball pixel coords.** Read **`grounding/PROTOCOL.md`** and run the loop with `node grounding/locate.mjs` (`overlay` → read strips → `region` → read crop → `final` → **`mark` + verify**). Zero keys/deps assumed (node + ffmpeg only); the optional `auto` fast path exists only when `GEMINI_API_KEY` happens to be set. Why: eyeballing put rings off-subject (~16–24% center error on weak vision models); the grid loop pulls it to ~2–4% (measured E2E: eyeball 6.5% → protocol 2.3% avg center error, no case worse).
4. **Eyedropper palette** from the asset (never generic #FFF/#000).

## Highlight + circle recipe (the common case)

"Ring / spotlight object X in a real image" → use the drop-in template **`samples/asset-fusion/_ref-circle-highlight.html`**: set `CFG.box` (from the locate protocol), `CFG.label`, `CFG.asset`, EVEN `CFG.W/H`, `CFG.mode` (`full` = ring+connector+label+brackets+scanlines, `circle` = ring only). It computes the radial wash, the amber double over-stroke ring, connector, callout, and corner-bracket reticle from the box. The whole pipeline is: locate (PROTOCOL.md) → fill template → render.

## Render gotchas (codified - skipping these breaks the render)

- **EVEN width & height** - odd width _or height_ (e.g. 1400×933) → `ffmpeg` encode fails / distorts. Resize the asset/stage to even dims (1400×932).
- **`data-width`/`data-height` must be STATIC HTML attrs on the stage** - the renderer's StaticGuard reads them at compile time, before JS runs. Setting them via `setAttribute` is too late → render falls back to portrait 1080×1920 and distorts. (The circle-highlight template now hard-codes them; keep them equal to `CFG.W/H`.)
- **Draw-on (`stroke-dashoffset`) must be opacity-gated** - `getTotalLength()` can read 0 before layout -> dash disabled -> a solid line shows at t=0. Gate every draw-on element with `opacity:0` / `visibility:"hidden"` until it draws, and fall back `getTotalLength() || <const>`.
- **CSS var tween scope** - `tl.add(":root", {"--x":..}, atMs)` won't reach an element that has its own inline `--x`; tween the var on the element itself.
- **No camera push under a fixed overlay** - scaling the image while the ring/wash stay fixed drifts the target out of the ring. Either skip the push or scale the whole scene together.
- Lossless delivery: `--format mov` (ProRes); `mp4` is lossy.

## Vocabulary / leans on

- Borrow the annotation kit from registry **`north-korea-locked-down`** (hand-drawn scribble circle draw-on, pop-up label + pointer, editorial wash, camera push).
- Primitives: gauge fill / marker-rise along the affordance · connector (data → asset point) · diegetic chart fused to the asset's geometry.
- Adapt the diegetic chart to each asset's affordance (read the geometry, fuse the data into it).

## Build (reuse-first + hand-author the affordance)

**Two layers**: asset (z0, full-bleed) + data graphics (z1+) fused to its geometry, anchored by `element_positions`; connectors/scribble physically tie the data to the asset; asset stays visible. Reference impl: the prototype `fusion-demo/index-annotated.html` (straw → gauge + borrowed annotation kit).
