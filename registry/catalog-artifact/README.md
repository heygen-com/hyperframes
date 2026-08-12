# Catalog artifact

Two files ship from here, and only these two. The CLI fetches them over HTTP
when a user opts into offline catalog search (`catalog --query ... --on-device`),
so they are served from the registry rather than bundled in the package.

| File                 | What it is                                                              |
| -------------------- | ----------------------------------------------------------------------- |
| `local-vectors.json` | `{ model, dimensions, names }`. `names` is the row order of the binary. |
| `local-vectors.bin`  | Float32, row-major, `names.length * dimensions` values, no header.      |

Currently 168 rows at 384 dimensions: 258,048 bytes, one row per installable
registry item.

## Provenance

No digest, revision or build timestamp is recorded in either file, and the
runtime only checks that `dimensions` matches the model it loaded. `model` is a
label the build wrote, not a proof. So the only real provenance check is to
rebuild the rows and compare them, which works because both inputs are in this
repository:

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
hand: a lefthook `catalog-index` pre-commit command regenerates and re-stages
both files whenever a staged `registry-item.json` changes, and CI fails the
"Catalog: search index covers the registry" job if the index is ever missing an
item.

`build-catalog-artifact.ts` does **not** produce these files. It builds the
3072-dimension hosted artifact from an external shelf file, for the hosted search
tier that this repository does not ship. Its `--shelf`, `manifest.json` and
`text-embedding-3-large` have nothing to do with `local-vectors.*`.
