/**
 * Embed the catalog with the on-device model so local search can rank by meaning.
 *
 * A second vector set, not a replacement. The hosted vectors are 1536-dimension
 * and measured; these are 384-dimension and free, and the two are not
 * interchangeable because vectors from different models cannot be compared.
 *
 * Usage:
 *   tsx scripts/catalog/build-local-vectors.ts --artifact <dir>
 *
 * Writes `local-vectors.bin` (float32, row-major, names in manifest order) and
 * `local-vectors.json` (names, dimensions, and the catalog digest it was built
 * from). Splitting them keeps the payload small enough to ship: 424 moves at
 * 384 dimensions is about 650 KB as binary against several megabytes as JSON.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  LOCAL_MODEL_DIMENSIONS,
  LOCAL_MODEL_ID,
} from "../../packages/cli/src/registry/localModel.js";
import { loadLocalEmbedder } from "../../packages/cli/src/registry/localEmbedder.js";

const BATCH = 16;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const dir = arg("artifact");
  if (!dir) throw new Error("--artifact <dir> is required");

  const catalog = JSON.parse(readFileSync(join(dir, "catalog.json"), "utf-8")) as Record<
    string,
    string
  >;
  const names = Object.keys(catalog).sort();
  const embedder = await loadLocalEmbedder();

  const vectors: number[][] = [];
  for (let start = 0; start < names.length; start += BATCH) {
    const slice = names.slice(start, start + BATCH);
    // Passages carry no query instruction; only queries do.
    vectors.push(...(await embedder.embed(slice.map((name) => catalog[name] as string))));
    process.stdout.write(`\r  embedded ${Math.min(start + BATCH, names.length)}/${names.length}`);
  }
  process.stdout.write("\n");

  const flat = new Float32Array(names.length * LOCAL_MODEL_DIMENSIONS);
  vectors.forEach((vector, row) => {
    if (vector.length !== LOCAL_MODEL_DIMENSIONS) {
      throw new Error(`vector for ${names[row]} has ${vector.length} dimensions`);
    }
    flat.set(vector, row * LOCAL_MODEL_DIMENSIONS);
  });

  writeFileSync(join(dir, "local-vectors.bin"), Buffer.from(flat.buffer));
  writeFileSync(
    join(dir, "local-vectors.json"),
    `${JSON.stringify({ model: LOCAL_MODEL_ID, dimensions: LOCAL_MODEL_DIMENSIONS, names }, null, 2)}\n`,
  );

  const megabytes = (flat.byteLength / 1024 / 1024).toFixed(2);
  console.log(`moves      ${names.length}`);
  console.log(`model      ${LOCAL_MODEL_ID}`);
  console.log(`dimensions ${LOCAL_MODEL_DIMENSIONS}`);
  console.log(`payload    ${megabytes} MB`);
  console.log(`written    ${dir}`);
}

await main();
