/**
 * Fails when the committed catalog vector artifact no longer represents the
 * registry it is meant to search.
 *
 * The pre-commit hook rebuilds when the opted-in model is available; CI verifies
 * freshness when it is not. Removing an item is self-healing at search time,
 * but every corpus change still invalidates the published revision so stale
 * vectors cannot pass the gate unnoticed.
 *
 * The corpus revision includes title, description, tags, model, and dimensions,
 * so same-name edits cannot hide behind a name-only coverage check. Computing
 * it needs no model and no network.
 */
import { readFileSync, readdirSync } from "node:fs";

import {
  LOCAL_MODEL_DIMENSIONS,
  LOCAL_MODEL_ID,
  LOCAL_MODEL_REVISION,
} from "../../packages/cli/src/registry/localModel.js";
import { catalogFromRegistry, localVectorRevision } from "./catalog-artifact.js";

type RegistryItem = { name: string; type?: string };
type Registry = { items: RegistryItem[]; catalogArtifact?: { revision?: string } };
type Artifact = { model?: string; dimensions?: number; revision?: string; names?: string[] };

const REGISTRY = "registry/registry.json";
const ARTIFACT = "registry/catalog-artifact/local-vectors.json";

function read<T>(path: string): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (error) {
    console.error(`Could not read ${path}: ${(error as Error).message}`);
    process.exit(1);
  }
}

const registry = read<Registry>(REGISTRY);
const artifact = read<Artifact>(ARTIFACT);
const corpus = catalogFromRegistry(
  "registry",
  (path) => readFileSync(path, "utf-8"),
  (path) =>
    readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
);

// Only blocks and components are searchable moves. Examples are starter
// projects a user scaffolds, never something `catalog` ranks, so the artifact
// deliberately carries no vector for them and demanding one would keep this
// gate permanently red.
const SEARCHABLE = new Set(["hyperframes:block", "hyperframes:component"]);
const registryNames = new Set(
  registry.items.filter((i) => SEARCHABLE.has(i.type ?? "")).map((i) => i.name),
);
const artifactNames = new Set(artifact.names ?? []);

const unindexed = [...registryNames].filter((n) => !artifactNames.has(n)).sort();
const dropped = [...artifactNames].filter((n) => !registryNames.has(n)).sort();
const expectedRevision = localVectorRevision(
  LOCAL_MODEL_ID,
  LOCAL_MODEL_REVISION,
  LOCAL_MODEL_DIMENSIONS,
  corpus,
);
const artifactRevisionMatches = artifact.revision === expectedRevision;
const registryRevisionMatches = registry.catalogArtifact?.revision === expectedRevision;

const show = (names: string[]) =>
  names
    .slice(0, 10)
    .map((n) => `    ${n}`)
    .join("\n") + (names.length > 10 ? `\n    ... and ${names.length - 10} more` : "");

console.log(`registry: ${registryNames.size} searchable items (blocks + components)`);
console.log(`artifact: ${artifactNames.size} vectors (${artifact.model ?? "unknown model"})`);

if (dropped.length > 0) {
  // Not fatal: the CLI filters these before a user ever sees them.
  console.log(`\nnote: ${dropped.length} vector(s) name items the registry no longer has.`);
  console.log(show(dropped));
  console.log("  These are filtered at search time, so they cost space, not correctness.");
}

if (unindexed.length > 0) {
  console.error(`\n${unindexed.length} registry item(s) have no vector:`);
  console.error(show(unindexed));
}

if (!artifactRevisionMatches || !registryRevisionMatches) {
  console.error("\nThe published vector revision does not match the searchable registry text.");
  console.error(`  expected: ${expectedRevision}`);
  console.error(`  artifact: ${artifact.revision ?? "missing"}`);
  console.error(`  registry: ${registry.catalogArtifact?.revision ?? "missing"}`);
}

if (unindexed.length > 0 || !artifactRevisionMatches || !registryRevisionMatches) {
  console.error(
    "\nMeaning search is stale. Word search still uses the live registry.\n\n" +
      "If you have the embedding model, regenerate and commit the artifact:\n" +
      "  bun scripts/catalog/build-local-vectors.ts\n\n" +
      "If you do not, leave it: changing a registry item does not require the model,\n" +
      "and a maintainer regenerates the index before merge.\n",
  );
  process.exit(1);
}

console.log("\nEvery searchable field matches the published vector revision.");
