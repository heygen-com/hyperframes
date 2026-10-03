# source phase — asset sourcing (asset-first)

Runs **only when `shot-plan.json.asset_needs` is non-empty**. A form category
can reach Source when it selected asset work such as a local reuse, edit, or
vectorization. Sources each needed asset → a **frozen project-local path** + a
ledger (`assets/index.md`). A need with `provider: "quiver"` routes to
`quiver.md`; all other needs retain the existing `/media-use` capture, search,
and asset-prep behavior.

## Per asset_need

- `provider: "quiver"` → follow `quiver.md` for the declared operation and
  keep its status, authorization, and provenance truthful.
- `image / icon / logo / svg` without a Quiver provider → media-use `resolve`:
  **search** (asset_scout: Google Images / SerpAPI + Noun Project),
  **generate** (image model), or **user-supplied** (logo). Optional `treatment`:
  cutout (remove-bg) / recolor / vectorize.
- `news / web / tweet` → **RWA-style search** (media-use's documented lineage — `media-use/references/search-strategy.md` traces `resolve` to the RWA subagent). Two-pole queries: **atomic** (1–3 words, composable) or **specific** (5–15 words: a news event / tweet); never the middle. A failed specific query is dropped, not broadened.

## Steps

1. Read `asset_needs` from `shot-plan.json` and classify each need by its
   optional provider and operation.
2. For a Quiver need, follow `quiver.md`. For another need, use the existing
   media-use analyze → search/capture/generate → review (use/maybe/reject)
   procedure; do not take the first result without review.
3. Freeze accepted material under `assets/`. For a Quiver or other vector/SVG
   need, freeze the chosen SVG and a separate matching PNG preview. For Quiver,
   decode the returned PNG when available, or render the exact frozen SVG
   locally when the provider does not return a preview. Never use the SVG path
   as `preview` or substitute a composition snapshot. For a non-Quiver
   raster/media-use need, including a no-provider existing JPEG or a supporting
   news/web/tweet asset, keep the ordinary media-use path and freeze the actual
   chosen local file(s); this path does not require an SVG/PNG pair or a Quiver
   provider. Write `assets/index.md` with `role`, `path`, and `provenance`
   first, then `preview`, `purpose`, and `observed limitations`.
4. Before Builder, the same controller must re-read the frozen files and ledger.
   For a Quiver or other vector/SVG need, verify that the SVG and PNG are
   distinct, regular, non-empty, readable files whose paths and provenance
   match the canonical ledger order. If the PNG cannot be retrieved or
   rendered from the same SVG, keep Source incomplete and stop. For a
   non-Quiver raster/media-use need, verify the declared local file(s) are
   non-empty and readable and that the ledger paths/provenance match; do not
   require SVG/PNG files or route the need through Quiver. Any handoff check
   failure keeps Source incomplete. Pass Builder only verified frozen local
   paths. Never pass a prompt or remote URL as a composition input. For
   `asset-fusion`, also capture measurable geometry and an eyedropper palette
   for Director Part 2.

## Degrade gracefully

If a provider, credential, permission, balance, or operation is unavailable,
mark the need with its distinct unmet status in `context.log` and the ledger.
Do not fabricate content, previews, creation IDs, or provenance. Preserve an
existing HyperFrames path when Quiver is optional and no Quiver asset work is
required. A non-Quiver search/provider may still use the existing documented
asset-free fallback where the category permits it.
