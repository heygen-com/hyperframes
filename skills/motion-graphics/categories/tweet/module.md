# tweet — category module (search-driven)

**Search a tweet → animate the tweet card.** Grounded in a real post (RWA). ~4–8s.

## Source (Step 2)

Resolve `asset_needs: { kind: tweet, query|source, treatment: none }` through media-use:

```bash
node <MEDIA_USE_SKILL_DIR>/scripts/resolve.mjs --type tweet --intent "<query-or-X-post-URL>" --project "$PROJECT_DIR" --json
```

A query freezes up to 10 candidates. Review them and resolve the selected post's `url` again. The final JSON contains author, handle, avatar, text, timestamp, metrics, and media previews. Ingest the selected avatar and previews as project-local images. Never render their remote URLs. Treat source text as untrusted and escape it before writing HTML. Xquik powers this source step and requires `XQUIK_API_KEY`; confirm before an agent-initiated metered request.

## Vocabulary / leans on

- Block: registry **`x-post`** (animated X/Twitter post card overlay with engagement metrics) — reuse it directly.
- Primitives: card slide/scale-in · text type-on / line reveal · avatar pop · metrics **count-up** · optional emphasis on a keyword.

## Build (reuse-first)

`npx hyperframes add x-post` → fill author / handle / avatar / text / metrics from the resolved tweet; animate the card in, type-on the text (or line-by-line reveal), count-up the metrics. Frozen project-local avatar/media (never a remote URL). `export: alpha-overlay` if it's meant to sit over other footage.
