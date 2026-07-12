# source phase — asset sourcing (asset-first)

Runs **only when `shot-plan.json.asset_needs` is non-empty** (the form categories never reach here). Sources each needed asset → a **frozen project-local path** + a ledger (`assets/index.md`). Uses `/media-use` (capture / asset prep) plus, **when an external asset-search skill such as media-use is installed**, its `resolve` step. If no such search capability is available, it **degrades to asset-free** (see below).

## Per asset_need

- `image / icon / logo / svg` → media-use `resolve`: **search** (asset_scout: Google Images / SerpAPI + Noun Project), **generate** (image model), or **user-supplied** (logo). Optional `treatment`: cutout (remove-bg) / recolor / vectorize.
- `news / web / tweet` → **RWA-style search** (media-use's documented lineage — `media-use/references/search-strategy.md` traces `resolve` to the RWA subagent). Two-pole queries: **atomic** (1–3 words, composable) or **specific** (5–15 words: a news event / tweet); never the middle. A failed specific query is dropped, not broadened.

## Steps

1. Read `asset_needs` from `shot-plan.json`.
2. For each: **analyze → search → review (use/maybe/reject — selection is the hard part; do NOT take the first/generated result) → freeze** the kept asset into `assets/` (rehost remote URLs).
3. Write `assets/index.md` — agent-readable ledger: `role → frozen path + provenance`.
4. For `asset-fusion`: also capture the asset's measurable geometry (so Director Part 2 can set `element_positions`) + an eyedropper palette.

## Degrade gracefully

If a provider / search is unavailable, mark the need unmet in `context.log`; the category falls back to asset-free where possible (e.g. `news` → typographic headline without the sourced image).

> Illustrative: `(cd "$PROJECT_DIR" && node <SKILL_DIR>/phases/source/resolve.mjs --plan ./shot-plan.json --out ./assets)` — or drive media-use's `resolve` procedure directly.
