# LUT library (authoring)

`index.json` is the agent-consumed catalog of color-grade looks. Each entry resolves
on demand — no `.cube` bodies are committed to the repo.

Each look has:

- `id`, `description`, `tags`, `intensity` — matching + application metadata.
- `url` (optional) — a hosted `.cube` downloaded, validated, and frozen at resolve
  time, exactly like bgm/image assets.
- `params` (optional) — a deterministic `buildCube` spec used offline (`--local-only`)
  or as a fallback if the `url` download/validation fails.

An entry needs at least one of `url` or `params`; prefer both (CDN url with a params
fallback) so resolution is never blocked on the network.

## Hosting a new look (operators)

1. Generate the `.cube` (e.g. `resolve -t lut --params '{...}'` or a graded export).
2. Upload it to the public CDN origin bucket:

   ```
   aws s3 cp <id>.cube s3://heygen-public/luts/<id>.cube
   ```

   It is then served at `https://static.heygen.ai/luts/<id>.cube` (CloudFront).

3. Add an entry to `index.json` with that `url` (and ideally a `params` fallback).
