// The vector builder validates two input formats and their artifact invariants.
// fallow-ignore-file complexity
/**
 * Embed the catalog with the on-device model so local search can rank by meaning.
 *
 * A second vector set, not a replacement. The hosted vectors are 3072-dimension
 * and measured; these are 384-dimension and free, and the two are not
 * interchangeable because vectors from different models cannot be compared.
 *
 * Usage:
 *   bun scripts/catalog/build-local-vectors.ts
 *
 * Defaults to reading `registry/` and writing `registry/catalog-artifact/`.
 *
 * Writes `local-vectors.bin` (float32, row-major, names in manifest order) and
 * `local-vectors.json` (names and dimensions). Splitting them keeps the payload small enough to ship: 424 moves at
 * 384 dimensions is about 650 KB as binary against several megabytes as JSON.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RegistryManifest } from "../../packages/core/src/index.js";

import {
  LOCAL_MODEL_DIMENSIONS,
  LOCAL_MODEL_ID,
  LOCAL_MODEL_REVISION,
} from "../../packages/cli/src/registry/localModel.js";
import { loadLocalEmbedder } from "../../packages/cli/src/registry/localEmbedder.js";
import { isLocalModelReady } from "../../packages/cli/src/registry/localModel.js";
import {
  catalogFromRegistry,
  LOCAL_VECTOR_BATCH_SIZE,
  localVectorRevision,
  mediaMetadataRevision,
  sha256Hex,
} from "./catalog-artifact.js";

export interface MediaVectorRow {
  id: string;
  kind: string;
  title: string;
  description: string;
  tags: string[];
  file: string;
  duration?: number;
  dimensions?: { width: number; height: number };
}

/** Distinct from 1 so the pre-commit hook can tell "cannot" from "failed". */
const EXIT_NO_MODEL = 3;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

// fallow-ignore-next-line high-crap-score
function mediaRows(manifestPath: string): MediaVectorRow[] {
  const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as
    | MediaVectorRow[]
    | Record<string, Omit<MediaVectorRow, "id" | "kind" | "title" | "tags"> & { tags?: string[] }>;
  const bundledSfx = manifestPath.endsWith("skills/media-use/audio/assets/sfx/manifest.json");
  const rootRelativeFile = (file: string): string =>
    bundledSfx && !file.startsWith("skills/") ? `skills/media-use/audio/assets/sfx/${file}` : file;
  const rows = Array.isArray(parsed)
    ? parsed.map((row) => ({ ...row, file: rootRelativeFile(row.file) }))
    : Object.entries(parsed).map(([id, entry]) => ({
        id,
        kind: "sfx",
        title: id,
        description: entry.description,
        tags: entry.tags ?? ["sfx"],
        file: rootRelativeFile(entry.file),
        ...(entry.duration === undefined ? {} : { duration: entry.duration }),
        ...(entry.dimensions === undefined ? {} : { dimensions: entry.dimensions }),
      }));
  if (rows.length === 0) throw new Error(`media manifest contains no rows: ${manifestPath}`);
  for (const row of rows) {
    if (
      !row.id ||
      !row.kind ||
      !row.file ||
      !row.title ||
      !row.description ||
      !Array.isArray(row.tags) ||
      !row.tags.every((tag) => typeof tag === "string")
    ) {
      throw new Error(`media manifest row is missing id, title, description, or file`);
    }
    if (row.duration !== undefined && (!Number.isFinite(row.duration) || row.duration < 0)) {
      throw new Error(`media manifest row ${row.id} has an invalid duration`);
    }
    if (
      row.dimensions !== undefined &&
      (!Number.isInteger(row.dimensions.width) ||
        !Number.isInteger(row.dimensions.height) ||
        row.dimensions.width <= 0 ||
        row.dimensions.height <= 0)
    ) {
      throw new Error(`media manifest row ${row.id} has invalid dimensions`);
    }
  }
  return [...rows].sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Embed in batches, in `names` order.
 *
 * Batch size is part of the artifact's identity, not a tuning knob: padding
 * within a batch changes the quantized result, so re-embedding the same text
 * at a different batch size does not reproduce the shipped rows.
 */
async function embedInBatches(
  names: string[],
  catalog: Record<string, string>,
  embedder: Awaited<ReturnType<typeof loadLocalEmbedder>>,
): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let start = 0; start < names.length; start += LOCAL_VECTOR_BATCH_SIZE) {
    const slice = names.slice(start, start + LOCAL_VECTOR_BATCH_SIZE);
    // Passages carry no query instruction; only queries do.
    vectors.push(...(await embedder.embed(slice.map((name) => catalog[name] as string))));
    process.stdout.write(
      `\r  embedded ${Math.min(start + LOCAL_VECTOR_BATCH_SIZE, names.length)}/${names.length}`,
    );
  }
  process.stdout.write("\n");
  return vectors;
}

/** Row-major Float32 payload. Row N belongs to `names[N]`, with no header. */
function packVectors(names: string[], vectors: number[][]): Float32Array {
  const flat = new Float32Array(names.length * LOCAL_MODEL_DIMENSIONS);
  vectors.forEach((vector, row) => {
    if (vector.length !== LOCAL_MODEL_DIMENSIONS) {
      throw new Error(`vector for ${names[row]} has ${vector.length} dimensions`);
    }
    flat.set(vector, row * LOCAL_MODEL_DIMENSIONS);
  });
  return flat;
}

// fallow-ignore-next-line complexity
async function main(): Promise<void> {
  const dir = arg("artifact") ?? "registry/catalog-artifact";
  const registryDir = arg("registry") ?? "registry";
  const manifestPath = arg("manifest");
  const basename = arg("output") ?? (manifestPath ? "media-vectors" : "local-vectors");

  // Read the corpus straight from the registry rather than from a catalog.json
  // built by the hosted-tier script. That file is not in the repo, so the
  // documented regeneration command used to fail on a missing path, which is
  // the whole reason the index was allowed to drift.
  const rows = manifestPath ? mediaRows(manifestPath) : undefined;
  const catalogMap = rows
    ? new Map(
        rows.map((row) => [
          row.id,
          `${row.title}\n${row.description}\n${row.tags.join(" ")}\n${row.kind}`,
        ]),
      )
    : catalogFromRegistry(
        registryDir,
        (path) => readFileSync(path, "utf-8"),
        (path) =>
          readdirSync(path, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => e.name),
      );
  const catalog = Object.fromEntries(catalogMap);
  const names = Object.keys(catalog).sort();
  if (names.length === 0) throw new Error(`no registry items found under ${registryDir}`);
  const revision = localVectorRevision(
    LOCAL_MODEL_ID,
    LOCAL_MODEL_REVISION,
    LOCAL_MODEL_DIMENSIONS,
    catalogMap,
  );
  // Embedding needs the model, and the model is a 32 MB opt-in that most
  // contributors will not have. Say so and stop, rather than failing inside the
  // ONNX loader with an ENOENT that names a path nobody set.
  if (!isLocalModelReady()) {
    console.error(
      "The embedding model is not on this machine, so the index cannot be rebuilt here.\n" +
        "That is fine: adding a registry item does not require it. Open the pull request\n" +
        "and a maintainer regenerates the index before merge.\n\n" +
        "To do it yourself, fetch the model once with:\n" +
        "  hyperframes catalog --query anything --on-device\n",
    );
    process.exit(EXIT_NO_MODEL);
  }

  const embedder = await loadLocalEmbedder();

  const vectors = await embedInBatches(names, catalog, embedder);
  const flat = packVectors(names, vectors);
  const credits =
    rows && manifestPath?.endsWith("skills/media-use/audio/assets/sfx/manifest.json")
      ? {
          file: "skills/media-use/audio/assets/sfx/CREDITS.md",
          sha256: sha256Hex(readFileSync("skills/media-use/audio/assets/sfx/CREDITS.md", "utf8")),
        }
      : undefined;

  writeFileSync(join(dir, `${basename}.bin`), Buffer.from(flat.buffer));
  writeFileSync(
    join(dir, `${basename}.json`),
    `${JSON.stringify({ model: LOCAL_MODEL_ID, modelRevision: LOCAL_MODEL_REVISION, dimensions: LOCAL_MODEL_DIMENSIONS, revision, names, ...(rows ? { rows, metadataRevision: mediaMetadataRevision(rows) } : {}), ...(credits ? { credits } : {}) }, null, 2)}\n`,
  );
  if (!rows) {
    const registryPath = join(registryDir, "registry.json");
    const registry = JSON.parse(readFileSync(registryPath, "utf-8")) as RegistryManifest;
    writeFileSync(
      registryPath,
      `${JSON.stringify({ ...registry, catalogArtifact: { revision } }, null, 2)}\n`,
    );
  }

  const megabytes = (flat.byteLength / 1024 / 1024).toFixed(2);
  console.log(`${rows ? "media" : "moves"}      ${names.length}`);
  console.log(`model      ${LOCAL_MODEL_ID}`);
  console.log(`dimensions ${LOCAL_MODEL_DIMENSIONS}`);
  console.log(`revision   ${revision}`);
  console.log(`payload    ${megabytes} MB`);
  console.log(`written    ${dir}/${basename}.{json,bin}`);
}

await main();
