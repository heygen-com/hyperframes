# maps - category module

Geographic motion: highlight regions, connect places, zoom to a location. **First decision: does the shot need a real basemap** (satellite/street/terrain imagery, globe, or zoom to a real address)? That picks the lane.

## Plan (Director)

Set `content.lane` first:

- **vector** (default) - stylized region shapes, no real imagery. Native + live in HF, cheap. `asset_needs: []`.
- **basemap** - needs real satellite/dark tiles, globe, or zoom-to-real-place. `asset_needs: [{ type: "map-bake", … }]`. **Bake the imagery in Source**: HF forbids render-time network and requires determinism, so live tiles (which re-fetch and can change per render) can't be the imagery layer - baking freezes it (and is smooth as a bonus). See Basemap lane + Determinism.

`content`: `{ lane, shot: highlight|flow|choropleth|labels|flag|pin-rollout|zoom-to, regions[], points[], basemap: satellite|dark, palette, headline, overlays: [label|pin|callout-card] }`.

`overlays` are independent of `shot` and work in both lanes. **`callout-card`** = a pinned card (flag chip + stat + progress bar) - this is the "documentary popup" (top #13); compose it on any zoom-to/highlight shot rather than treating it as its own shot.

## Vocabulary / leans on

**Vector lane** (D3 + TopoJSON - reuse the existing map family, don't duplicate):

- Reuse: `us-map` (+bubble/hex/flow), `world-map`, `spain-map`.
- **Hand-author** these (NOT in the catalog - build per the signatures below, don't expect an `add`): `geo-highlight` (N countries colored + labels + border pulse), `geo-flow` (world arcs / hub network), `flag-borders` (flag clipped to a country), `pin-rollout` (cities pulse in sequence + counter).
- Signature: country fill-in stagger · pin drop + pulse ring · arc `stroke-dashoffset` draw-on + flyer · choropleth color reveal · **viewBox** zoom.

**Basemap lane** (MapLibre, baked in Source - validated pipeline, `bake-basemap.mjs`, fully env-parametric - runs for any country, not just the prototypes):

- **Bake** `bake-basemap.mjs` (puppeteer + MapLibre; env-driven: `NAME STYLE COUNTRIES CENTER ZSTART ZEND PITCH BEARING FPS DUR`): drive the camera **zoom→hold** (`easeInOutCubic`) and **`await map.once('idle')` before every frame** so each frame has complete tiles (Remotion `delayRender` technique → no tile pop). The helper resolves Chrome itself, pins deps exactly, derives the overseas-territory filter per subject, and **fails loud on idle-timeout** (suspect frames → non-zero exit). _External deps: the pinned CDN libs (maplibre/topojson/world-atlas) + the Esri/CARTO tile endpoints are third-party - re-verify availability + ToS on any version bump._ `preserveDrawingBuffer:true`, `fadeDuration:0`. The helper then **encodes the frames to an all-intra MP4 itself** (`ffmpeg -framerate FPS -i f%04d.png -c:v libx264 -g 1 -pix_fmt yuv420p`) and writes everything to **`$OUT` (default `cwd`)**, not the skill dir → `<NAME>.mp4` + `<NAME>-coords.json`.
- **Export geo→screen** at the hold view: `map.project()` each requested country → `<NAME>-coords.json` = `{ view, countries: [{ name, color, d (SVG path), bbox, label }] }`. The camera holds static after the zoom, so these paths stay pixel-aligned. `label` is an **approximate** anchor (vertex-average of the mainland ring - for concave countries nudge per Legibility). Consume `coords.countries[i]`; the `smooth-frde2`/`smooth-flag` example dirs predate this helper and use a flat `{fr,de,…}` shape, so adapt their wiring.
- **Builder**: `<video>` basemap on track 0 + an **SVG overlay** that, during the hold, animates country **borders (`stroke-dashoffset` draw-on)** + **fills (colour-block reveal)** + labels/pins/cards - all geo-aligned via `coords.json`. This reproduces the Hera "satellite + animated coloured borders/callouts" look.
  - The same projected path also doubles as an SVG **`clipPath`**: clip a **flag (or any texture) into the real border** for _flag-in-borders_ - a richer fill than flat colour, over real map context (validated: France tricolor over a dark basemap, `smooth-flag`). Export the feature's screen **bbox** alongside its path so the flag stripes/texture can be sized to the country.
- **Stretch / data gaps** (extend `bake-basemap.mjs` as needed - the eval agents did): a **globe intro** ("start from the globe") = MapLibre `projection:{type:'globe'}` for the opening phase, easing to mercator at the target (the helper defaults to mercator). **Sub-national** regions (states/provinces) aren't in world-atlas (country-only) → use a Natural Earth **admin-1** TopoJSON, or project centroids as pins (`pin-rollout`).

## Build (reuse-first)

Vector: `npx hyperframes add <block>` → edit regions/data/palette in place. Basemap: baked `map.mp4` as track-0 `<video>`, bind overlays to anchors.

**Restraint (no cheese - this is the #1 way auto-built maps go wrong):** every animated element must serve the message - region, connector, label, pin, camera. **NO decorative ambient glows, background light blobs, floating particles, lens flares, or gratuitous bloom.** Motion = a continuous camera move (viewBox push/zoom) + purposeful, overlapping element reveals - not a light show. Palette: color must **carry meaning** - a data scale (choropleth), categorical fills that distinguish regions (political map), or 1–2 accents for the subjects (highlighted countries / route) over neutral everything-else. Don't add color as **decoration** (a country amber just for contrast, a glow for "energy"). The frame should read like a clean broadcast map, not a screensaver.

**Legibility (hard rule):** offset labels from the highlighted shape and from each other; clamp to the safe area; a callout pill must not sit on another label or a border (the eval surfaced a DE/PL "Oder–Neisse" pill overlapping the POLAND label). A key element stays readable ≥~0.3s.

**Attribution (hard rule):** real basemap imagery carries usage terms - bake a credit element into the composition whenever a basemap is on screen (Esri satellite → "Esri, Maxar, Earthstar Geographics"; CARTO → "© CARTO, © OpenStreetMap"). A small low-corner label (see `smooth-jp`). Non-negotiable for anything published.

**Determinism (hard rules - each one bit us in the prototypes):**

- Drive everything from the seek clock; **never `tl.call`** for stateful updates (counters, text) → proxy tween + `onUpdate` (tl.call freezes the timeline under HF seek).
- SVG zoom = animate **viewBox** (don't hand-compute group transform origins).
- Centered overlays (cards/labels using `transform: translate(-50%,...)` to center): animate **opacity only**, or wrap in an outer centered div, anime.js `translateY` / `scale` tweens overwrite the whole transform and kill the centering.
- Country geometry: filter to the polygon(s) **in a lon/lat box around the subject** - world-atlas bundles overseas territories that blow up the bbox (France + Guiana). Keep near islands (Corsica, Sicily), drop far ones. (`bake-basemap.mjs` anchors on the vertex-richest polygon ± `KEEPMARGIN` - no continent-specific constant.)
- **Tile world-scale**: MapLibre's internal world width is `512·2^zoom` regardless of the raster `tileSize`. Esri/CARTO raster → `tileSize:256` (correct); a 512px / @2x / retina / vector source needs `tileSize:512` or every zoom level is off by one (this silently over-zoomed a bake once - France overflowed the frame top-to-bottom).
- **Antimeridian**: a feature crossing ±180° (Russia, Fiji, NZ) smears under per-vertex `map.project()`. `bake-basemap.mjs` **unwraps longitudes around the camera-center ref** before projecting, which handles it; it still warns if a feature spans >180° even after unwrap.
- **Smoothness = per-frame complete tiles + eased camera.** In the bake, `await map.once('idle')` before each screenshot (= Remotion `delayRender`) and ease the camera with `easeInOutCubic` (= interpolate+Easing). `preserveDrawingBuffer:true`, `fadeDuration:0`, large `maxTileCacheSize`.
- **Overlay alignment**: project feature borders at a **held** camera and only animate the overlay during the hold - a moving camera + a fixed projected path drift apart.
- **Pre-hold hidden state**: an overlay revealed _at_ the hold must have a zero-duration anime.js hidden state at build time (`scaleX:0`, full `stroke-dashoffset`, `opacity:0`), a bare from-to tween does **not** apply its "from" until the tween starts, so the element otherwise shows at its natural (visible, mispositioned) state during the zoom-in.
- **Why bake at all** (the real reason - not just smoothness): baking freezes the imagery into **deterministic** pixels. Live raster tiles re-fetch every render and can change, and render-time network is forbidden. MapLibre _does_ render live in HF (just janky: tiles pop, deep zooms outrun loading); exposing the engine's per-frame `onBeforeCapture` hook (it exists - `frameCapture.ts:~1250`) would make live **smooth** - but it would **not** remove the need to freeze tiles for **determinism + offline reproducibility**. So `onBeforeCapture` would replace the _smoothness_ role of baking, not the _freeze_ role.

## Out of scope

3D photorealistic landmarks (Cesium territory) · per-country / per-template blocks (parametrize instead) · charts (→ `charts`). (In-engine _live_ MapLibre is possible but janky today - bake instead; revisit if the engine gains a per-frame ready hook.)

## Register

`director.md` classifier line (the lane fork) + `catalog-map.md` `maps/geo` row (add the basemap lane). Phase pipeline untouched.
