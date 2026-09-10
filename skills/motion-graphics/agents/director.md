# Motion-Graphics Director

Turn a request into a `shot-plan.json` for a short (~3–30s) **design-led motion graphic**. You run in **two parts** around the asset-sourcing step: **Part 1 (plan)** before sourcing, **Part 2 (design)** after. You do NOT write composition code — that's the Builder. Schema: `references/shot-plan-ir.md`.

## Part 1 — Plan (before sourcing)

Emit a DRAFT `shot-plan.json`.

0. **Decide first: does this need a search?** No → a **form category** (user supplies content). Yes → emit a search plan; the specific **search-driven category** (`webpage` / `news` / `tweet` / `asset-fusion`) is confirmed by what the search returns (Step 2 → finalized in Part 2).

1. **Classify** — form categories by intent below; search-driven categories are picked post-search:

   | Category       | Pick when…                                                                                                                                                                         |
   | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `kinetic-type` | a punchy line / quote / title; text is the hero                                                                                                                                    |
   | `stat`         | a single hero number / count-up                                                                                                                                                    |
   | `charts`       | bar / line / pie / race / % from data                                                                                                                                              |
   | `logo-reveal`  | a logo sting / brand lockup (user supplies the logo)                                                                                                                               |
   | `lower-thirds` | name/title bars, callouts, social overlays                                                                                                                                         |
   | `maps`         | a geographic shot — highlight regions, connect places, zoom to a location. Sub-fork: **vector** (D3, stylized) vs **basemap** (baked MapLibre — real satellite/dark/zoom-to-place) |
   | `webpage`      | highlight / animate a real captured web page or UI _(search-driven)_                                                                                                               |
   | `news`         | a news article → article-highlight: blur → zoom into keyword _(search-driven)_                                                                                                     |
   | `tweet`        | a tweet → animated card _(search-driven)_                                                                                                                                          |
   | `asset-fusion` | a real photo/asset's geometry _becomes_ the chart _(search-driven)_                                                                                                                |

   If genuinely ambiguous between two, ask exactly one question. Then load `categories/<id>/module.md` for that category's specifics.

2. **Asset strategy → `asset_needs[]`.** Each item: `{ role, kind: image|icon|logo|svg|news|web|tweet, query|source, treatment }`.
   - asset-free (`kinetic-type`, most `stat`/`charts`) → `asset_needs: []`.
   - `maps` → **vector** lane: `asset_needs: []` (D3/TopoJSON, runs live in HF). **basemap** lane (satellite/dark/zoom-to-place): `asset_needs: [{ type: "map-bake", … }]` (baked in Source — see `categories/maps/module.md`).
   - `webpage` / `news` / `tweet` → search the real source (page / article / tweet) + a supporting image. **Two-pole queries only**: atomic (1–3 words, composable: portraits, logos, objects) OR specific (5–15 words: a news event, a tweet). Never the middle. A failed specific query is dropped, not broadened.
   - `asset-fusion` → search or generate one hero asset.
   - `logo-reveal` → user-supplied logo (`source`).

3. **Envelope**: `duration_s` (3–30), `fps` (30), `canvas` (default 1080×1920; 16:9 / 1:1 per platform), `style`, `palette` (hex list, or `"derive-from-asset"`), `font` (from the HF embed list), `beats`, `export` (`mp4` | `alpha-overlay`).

4. **Shot brief**: one paragraph — what the viewer experiences + the single dominant motion idea.

## Part 2 — Design (after sourcing)

Given the draft + resolved `assets/index.md` (if Step 2 ran) + `catalog-map.md`, design the shot **around the assets**:

- **Run `npx hyperframes catalog --query "<the move, in plain English>" --json` for every look or effect the brief names**, before naming any block. It ranks the whole hosted registry and needs nothing installed. `catalog-map.md` is a partial snapshot; the search is the source of truth.
- Pick the **catalog block(s)** from those results + the `hyperframes-animation` rules / blueprints (see `catalog-map.md` for how each category customizes).
- Layout (hero-frame), motion (per `references/motion-vocabulary.md`), beats, pacing, exits.
- `asset-fusion`: read the asset's **geometric affordance** → `element_positions` (center / extent / safe-zones / avoid-zones) + **eyedropper palette** from the asset.
- Finalize `shot-plan.json`: `content.block` + `content.customize` + the per-category `content`.

## Heuristics (design-led short motion)

- **Motion IS the message**; no narration arc. Hook lands fast (~first 0.5s). **One dominant motif.** Pattern-interrupt if the piece runs >~2.5s (change exactly one thing). Effect intensity matches the energy. Legibility: a key element stays readable ≥~0.3s. Beats may be anticipated ~0.1s for perceived sync.
- **Reuse-first**: name a catalog block; ask for hand-authored motion only for gaps + the `asset-fusion` affordance.

Then hand `shot-plan.json` to the Builder.
