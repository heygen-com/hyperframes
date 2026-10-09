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
import {
  catalogFromRegistry,
  localVectorRevision,
  mediaMetadataRevision,
  sha256Hex,
} from "./catalog-artifact.js";

type RegistryItem = { name: string; type?: string };
type Registry = { items: RegistryItem[]; catalogArtifact?: { revision?: string } };
type Artifact = { model?: string; dimensions?: number; revision?: string; names?: string[] };
type MediaArtifact = {
  model?: string;
  modelRevision?: string;
  dimensions?: number;
  revision?: string;
  metadataRevision?: string;
  credits?: { file?: string; sha256?: string };
  names?: string[];
  rows?: Array<{
    id?: string;
    file?: string;
    title?: string;
    description?: string;
    tags?: string[];
    kind?: string;
  }>;
};

const REGISTRY = "registry/registry.json";
const ARTIFACT = "registry/catalog-artifact/local-vectors.json";
const MEDIA_MANIFEST = "skills/media-use/audio/assets/sfx/manifest.json";
const MEDIA_ARTIFACT = "registry/catalog-artifact/media-vectors.json";

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
const mediaSource =
  read<Record<string, { file?: string; description?: string; duration?: number }>>(MEDIA_MANIFEST);
const mediaArtifact = read<MediaArtifact>(MEDIA_ARTIFACT);
const mediaRowsFromSource = Object.entries(mediaSource)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([id, source]) => ({
    id,
    kind: "sfx",
    title: id,
    description: source.description ?? "",
    tags: ["sfx"],
    file: `skills/media-use/audio/assets/sfx/${source.file ?? ""}`,
    ...(source.duration === undefined ? {} : { duration: source.duration }),
  }));
const mediaEntries = new Map(
  mediaRowsFromSource.map((row) => [
    row.id,
    `${row.title}\n${row.description}\n${row.tags.join(" ")}\n${row.kind}`,
  ]),
);
const expectedMediaRevision = localVectorRevision(
  LOCAL_MODEL_ID,
  LOCAL_MODEL_REVISION,
  LOCAL_MODEL_DIMENSIONS,
  mediaEntries,
);
const expectedMediaMetadataRevision = mediaMetadataRevision(mediaRowsFromSource);
const expectedCredits = {
  file: "skills/media-use/audio/assets/sfx/CREDITS.md",
  sha256: sha256Hex(readFileSync("skills/media-use/audio/assets/sfx/CREDITS.md", "utf8")),
};
const mediaBin = readFileSync(MEDIA_ARTIFACT.replace(/\.json$/, ".bin"));
const mediaRows = new Map(
  (mediaArtifact.rows ?? [])
    .filter(
      (row): row is { id: string; file: string } =>
        typeof row.id === "string" && typeof row.file === "string",
    )
    .map((row) => [row.id, row.file]),
);
const missingMediaRows = Object.entries(mediaSource)
  .filter(
    ([id, source]) =>
      mediaRows.get(id) !== `skills/media-use/audio/assets/sfx/${source.file ?? ""}`,
  )
  .map(([id]) => id)
  .sort();
const mediaNames = mediaArtifact.names ?? [];
const mediaRowsMatchNames =
  (mediaArtifact.rows ?? []).length === mediaNames.length &&
  (mediaArtifact.rows ?? []).every((row, index) => row.id === mediaNames[index]);
const mediaRowsMatchSource =
  JSON.stringify(mediaArtifact.rows ?? []) === JSON.stringify(mediaRowsFromSource);
const mediaArtifactValid =
  mediaArtifact.model === LOCAL_MODEL_ID &&
  mediaArtifact.modelRevision === LOCAL_MODEL_REVISION &&
  mediaArtifact.dimensions === LOCAL_MODEL_DIMENSIONS &&
  mediaArtifact.revision === expectedMediaRevision &&
  mediaArtifact.metadataRevision === expectedMediaMetadataRevision &&
  mediaArtifact.credits?.file === expectedCredits.file &&
  mediaArtifact.credits.sha256 === expectedCredits.sha256 &&
  mediaRowsMatchSource &&
  mediaRowsMatchNames &&
  mediaBin.byteLength === mediaNames.length * LOCAL_MODEL_DIMENSIONS * 4;

const show = (names: string[]) =>
  names
    .slice(0, 10)
    .map((n) => `    ${n}`)
    .join("\n") + (names.length > 10 ? `\n    ... and ${names.length - 10} more` : "");

console.log(`registry: ${registryNames.size} searchable items (blocks + components)`);
console.log(`artifact: ${artifactNames.size} vectors (${artifact.model ?? "unknown model"})`);
console.log(
  `media: ${mediaRows.size} rows for ${Object.keys(mediaSource).length} bundled SFX files`,
);

if (missingMediaRows.length > 0) {
  console.error(`\n${missingMediaRows.length} bundled SFX file(s) have no matching media row:`);
  console.error(show(missingMediaRows));
}
if (!mediaArtifactValid) {
  console.error("\nThe published media vector metadata or binary does not match the SFX manifest.");
}

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

if (
  unindexed.length > 0 ||
  !artifactRevisionMatches ||
  !registryRevisionMatches ||
  missingMediaRows.length > 0 ||
  !mediaArtifactValid
) {
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
