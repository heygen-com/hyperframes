# shot-plan IR

The single contract between Director and Builder. One file: `PROJECT_DIR/shot-plan.json`.

```jsonc
{
  // ── envelope (every category) ──
  "category": "kinetic-type | stat | charts | logo-reveal | lower-thirds | webpage | news | tweet | asset-fusion",
  "duration_s": 6,
  "fps": 30,
  "canvas": { "w": 1080, "h": 1920, "aspect": "9:16" },
  "style": "free-form visual direction (mood / energy / reference)",
  "palette": ["#…"], // or "derive-from-asset"
  "font": "<HF embed-list font>",
  "beats": [12, 37], // optional accent frames/seconds
  "export": "mp4", // or "alpha-overlay" (transparent webm/mov)

  // ── sourcing seam (Director Part 1) — [] means skip the source phase ──
  "asset_needs": [
    {
      "role": "hero",
      "kind": "image|icon|logo|svg|news|web|tweet",
      "query": "…",
      "source": "…",
      "treatment": "cutout|recolor|vectorize|none",
      "provider": "quiver", // optional; omit for the existing media-use path
      "operation": "reuse|generate|vectorize|edit|animate", // required with provider: "quiver"
    },
  ],

  // ── build directive (Director Part 2, reuse-first) ──
  "block": "<catalog block id, e.g. data-chart | caption-kinetic-slam>", // optional
  "customize": {
    /* what to change on the block: data, text, palette, positions */
  },

  // ── category-specific content ──
  "content": {
    /* shape varies by category, below */
  },
}
```

**Per-category `content` shapes:**

- `kinetic-type` → `scenes[]` `{ id, start, end, text, emphasis_words[], emotion, motion, beats[] }`
- `stat` → `{ value, prefix, suffix, label, ring: bool }`
- `charts` → `{ type: bar|line|pie|race|pct, data[], labels[], headline, axes: bool }`
- `logo-reveal` → `{ logo: <asset path>, tagline, url }`
- `lower-thirds` → `{ name, role, position, brand_colors[] }`
- `webpage` → `{ url, capture, highlights: [ { selector|region, label } ] }` (step-highlight a real captured page)
- `news` → `{ outlet, headline, body, keyword, layout: A|B, logo?, date?, subject? }` (article-highlight: lay text out readable — **no zoom** — then sweep a marker band over the keyword in place. Layout **A** = centered-emphasis 9:16 text-only; **B** = full article 16:9 with `logo` + `date` + `subject` (a person photo → `remove-background` cutout))
- `tweet` → `{ author, handle, avatar, text, metrics }`
- `asset-fusion` → `{ data_type, asset: <path>, affordance, element_positions: {center, extent, safe[], avoid[]}, derived_palette[], connectors[] }`

**Invariants:** `scenes` (if present) partition `[0, duration_s]` with no gaps/overlaps · empty `asset_needs` means no asset work is required and Step 2 (source) is skipped · a selected asset operation creates a non-empty need, including for a form category · a need with `provider: "quiver"` also declares `operation` · Source resolves every completed need to a frozen local path before Builder uses it · a named `block` ⇒ the Builder reuses + customizes it rather than hand-authoring.
