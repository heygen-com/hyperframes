# Catalog artifact

The CLI fetches these files over HTTP when a user opts into on-device catalog
search (`catalog --query ... --on-device`), so they are served from the registry
rather than bundled in the package. How the search uses them is in
[How catalog search works](https://hyperframes.heygen.com/developers/catalog-search).

| File                 | What it is                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| `local-vectors.json` | `{ model, modelRevision, dimensions, revision, names }`. `names` is the row order of the binary. |
| `local-vectors.bin`  | Float32, row-major, `names.length * dimensions` values, no header.                               |

One row per installable registry item, at 384 dimensions.

`media-vectors.*` are the same kind of index over the bundled sound effects in
`skills/media-use/audio/assets/sfx/manifest.json`, built with `--manifest`.
Everything below is about `local-vectors.*`.

## Provenance

`revision` is a sha256 over the model, its revision, the dimensions, the batch
size and every item's name and embedded text, and the build writes the same value
to `registry.json` as `catalogArtifact.revision`. The CLI refetches its cached copy
when the two differ. That names the inputs the build claims, not that the floats
came from them, so the only real provenance check is to rebuild the rows and
compare them, which works because both inputs are in this repository:

- the text each row was embedded from is `itemRetrievalText(registry-item.json)`
  (title, description, tags, joined by newlines, name deliberately excluded),
  over `registry/blocks/*` and `registry/components/*` sorted by name;
- the model is the pinned quantized `bge-small-en-v1.5` ONNX build that
  `packages/cli/src/registry/localModel.ts` downloads.

Re-embedding in batches of 16, the batch size the build uses, reproduces the
shipped rows exactly (cosine 1.000000). Batch size matters: the same text
embedded alone differs at cosine 0.9969, because padding within a batch changes
the quantized result. A rebuild that does not match this way was not built from
this registry, or not with this model.

## Rebuilding

```bash
bun scripts/catalog/build-local-vectors.ts
```

It reads `registry/blocks/*` and `registry/components/*` directly, so the
rebuild has no input outside this repository. You rarely need to run it by
hand: `bun run generate:catalog` runs it after downloading the pinned model, the
catalog publication PR regenerates these files after source changes merge, and CI
fails the "Catalog: search index covers the registry" job if the index is ever
missing an item.

`build-catalog-artifact.ts` does **not** produce these files. It builds the
3072-dimension hosted artifact from an external shelf file, for the hosted search
tier that this repository does not ship. Its `--shelf`, `manifest.json` and
`text-embedding-3-large` have nothing to do with `local-vectors.*`.
