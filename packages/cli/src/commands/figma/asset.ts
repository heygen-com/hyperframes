/**
 * `hyperframes figma asset <ref>` — Phase 1 of the figma integration:
 * render a node over REST, sanitize (svg), freeze under .media/, record
 * provenance in the shared manifest, print a composition snippet.
 */

import { defineCommand } from "citty";
import {
  appendRecord,
  buildAssetSnippet,
  createFigmaClient,
  FigmaClientError,
  findAllByFigmaNode,
  freezeBytes,
  nextId,
  parseFigmaRef,
  regenerateIndex,
  sanitizeSvg,
  typeDirPath,
  updateRecord,
  type AssetSnippet,
  type FigmaAssetFormat,
  type FigmaClient,
  type FigmaManifestRecord,
} from "@hyperframes/core/figma";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { downloadRender } from "./download.js";
import { withFigmaErrors } from "./cliError.js";

export interface AssetImportOptions {
  format: FigmaAssetFormat;
  scale?: number;
  /** human description — lands in the manifest + index.md + <img alt> */
  description?: string;
  /** media-use interop: entity name for `resolve --entity` cache hits */
  entity?: string;
}

export interface AssetImportDeps {
  projectDir: string;
  client: FigmaClient;
  /** fetch a short-lived figma CDN url into bytes; injectable for tests */
  download: (url: string) => Promise<Uint8Array>;
}

export interface AssetImportResult {
  record: FigmaManifestRecord;
  snippet: AssetSnippet;
  reused: boolean;
}

/**
 * Flatten CLI positionals into asset refs. Comma-splits bare
 * `fileKey:nodeId` tokens (so `asset A,B` batches) but leaves URL tokens
 * whole — a figma URL can carry commas in its query (multi-select
 * `node-id=1:2,3:4`), and splitting those would tear the URL apart. To batch
 * URLs, pass them as separate positional args.
 */
export function gatherAssetRefs(positionals: string[]): string[] {
  return positionals
    .flatMap((r) => (/^https?:/i.test(r.trim()) ? [r] : r.split(",")))
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
}

function requireNodeRef(refInput: string): { fileKey: string; nodeId: string } {
  const ref = parseFigmaRef(refInput);
  if (!ref.nodeId)
    throw new Error(
      `ref "${refInput}" has no node id — share a link with ?node-id=… or use fileKey:nodeId`,
    );
  return { fileKey: ref.fileKey, nodeId: ref.nodeId };
}

/** Cache hit per spec §5 (fileKey:nodeId:format:scale:version). Check EVERY
 * row for the node — a node can carry several format/scale/version tuples,
 * and the oldest-row shortcut minted duplicates forever. Reuse requires the
 * frozen file to still exist; a deleted file falls through to re-import.
 * Metadata supplied on a re-import upserts rather than being discarded. */
function reuseExisting(
  fileKey: string,
  nodeId: string,
  opts: AssetImportOptions,
  version: string,
  deps: AssetImportDeps,
  description: string | undefined,
  entity: string | undefined,
): AssetImportResult | null {
  const existing = findAllByFigmaNode(deps.projectDir, fileKey, nodeId).find(
    (r) =>
      r.provenance.format === opts.format &&
      (r.provenance.scale ?? 1) === (opts.scale ?? 1) &&
      r.provenance.version === version &&
      existsSync(join(deps.projectDir, r.path)),
  );
  if (!existing) return null;
  let record = existing;
  if (
    (description !== undefined && description !== existing.description) ||
    (entity !== undefined && entity !== existing.entity)
  ) {
    record = {
      ...existing,
      ...(description !== undefined && { description }),
      ...(entity !== undefined && { entity }),
    };
    updateRecord(deps.projectDir, record);
  }
  return { record, snippet: buildAssetSnippet(record), reused: true };
}

/** Freeze a rendered node's bytes and record it. Does NOT regenerate index.md
 * — the caller does that once (batch imports would otherwise rewrite it N
 * times). */
async function freezeAndRecord(
  fileKey: string,
  nodeId: string,
  url: string,
  ext: FigmaAssetFormat,
  opts: AssetImportOptions,
  version: string,
  deps: AssetImportDeps,
  description: string | undefined,
  entity: string | undefined,
): Promise<AssetImportResult> {
  let bytes = await deps.download(url);
  if (ext === "svg") {
    // Sniff before decoding: an SVG starts with '<' or an XML decl/BOM. A
    // non-text payload would decode to U+FFFD soup and still write to disk.
    const b0 = bytes[0];
    if (b0 !== 0x3c && b0 !== 0x3f && b0 !== 0xef)
      throw new Error("figma render returned non-SVG bytes for an svg export — retry the import");
    bytes = new TextEncoder().encode(sanitizeSvg(new TextDecoder().decode(bytes)));
  }
  const id = nextId(deps.projectDir, "image");
  const destAbs = join(typeDirPath(deps.projectDir, "image"), `${id}.${ext}`);
  freezeBytes(bytes, destAbs);
  const record: FigmaManifestRecord = {
    id,
    type: "image",
    path: relative(deps.projectDir, destAbs),
    source: `figma:${fileKey}/${nodeId}`,
    ...(description !== undefined && { description }),
    ...(entity !== undefined && { entity }),
    provenance: {
      source: "figma",
      fileKey,
      nodeId,
      version,
      format: opts.format,
      scale: opts.scale,
    },
  };
  appendRecord(deps.projectDir, record);
  return { record, snippet: buildAssetSnippet(record), reused: false };
}

export async function runAssetImport(
  refInput: string,
  opts: AssetImportOptions,
  deps: AssetImportDeps,
): Promise<AssetImportResult> {
  const [result] = await runAssetImportMany([refInput], opts, deps);
  if (!result) throw new Error(`figma asset import produced no result for "${refInput}"`);
  return result;
}

/**
 * Import many nodes of ONE figma file. Cache-checks each, renders the misses
 * in a SINGLE /v1/images batch call (figma's documented rate-limit
 * workaround — N nodes, one REST request), freezes each, and regenerates
 * index.md once. Results come back in input order.
 */
export async function runAssetImportMany(
  refInputs: string[],
  opts: AssetImportOptions,
  deps: AssetImportDeps,
): Promise<AssetImportResult[]> {
  if (refInputs.length === 0) return [];
  const refs = refInputs.map(requireNodeRef);
  const fileKey = refs[0]!.fileKey;
  const mixed = refs.find((r) => r.fileKey !== fileKey);
  if (mixed)
    throw new Error(
      `all refs in one import must share a fileKey (batch is per-file) — got ${fileKey} and ${mixed.fileKey}; run separate commands per file`,
    );

  const { version } = await deps.client.fileVersion(fileKey);
  const description = normalizeMeta(opts.description);
  const entity = normalizeMeta(opts.entity);

  // Resolve cache hits first; batch-render only the misses.
  const slots: (AssetImportResult | null)[] = refs.map((r) =>
    reuseExisting(fileKey, r.nodeId, opts, version, deps, description, entity),
  );
  const missIndexes = slots.flatMap((s, i) => (s === null ? [i] : []));
  try {
    if (missIndexes.length > 0) {
      const missNodeIds = missIndexes.map((i) => refs[i]!.nodeId);
      const rendered = await deps.client.renderNodes(fileKey, missNodeIds, opts);
      const byNode = new Map(rendered.map((r) => [r.nodeId, r] as const));
      for (const i of missIndexes) {
        const nodeId = refs[i]!.nodeId;
        const r = byNode.get(nodeId);
        // Keep the typed code: component import's rasterize fallback skips on
        // RENDER_FAILED, so a plain Error here would abort the whole import.
        if (!r || r.url === null)
          throw new FigmaClientError(
            "RENDER_FAILED",
            `figma could not render node ${nodeId} as ${opts.format}`,
          );
        slots[i] = await freezeAndRecord(
          fileKey,
          nodeId,
          r.url,
          r.ext,
          opts,
          version,
          deps,
          description,
          entity,
        );
      }
    }
  } finally {
    // Regenerate once — in `finally` so a mid-batch RENDER_FAILED still leaves
    // index.md consistent with the nodes that DID freeze, not stale until the
    // next import.
    safeRegenerateIndex(deps.projectDir);
  }
  return slots.map((s, i) => {
    if (!s) throw new Error(`figma asset import produced no result for "${refInputs[i]}"`);
    return s;
  });
}

/** index.md is a single table row per record — newlines/tabs in a
 * description would corrupt the whole table. */
function normalizeMeta(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

/** Keep the agent-readable inventory in step with the manifest (media-use
 * regenerates the same file after its writes). Best-effort: the import is
 * already durable, so an index write failure must not fail the command. */
function safeRegenerateIndex(projectDir: string): void {
  try {
    regenerateIndex(projectDir);
  } catch (err) {
    console.warn(`index.md regeneration failed: ${err instanceof Error ? err.message : err}`);
  }
}

const FORMATS: readonly FigmaAssetFormat[] = ["png", "svg", "jpg", "pdf"];

function parseFormat(raw: string): FigmaAssetFormat {
  for (const f of FORMATS) if (f === raw) return f;
  throw new Error(`unsupported format "${raw}" — use one of ${FORMATS.join(", ")}`);
}

export default defineCommand({
  meta: { name: "asset", description: "Import one or more figma nodes as frozen local assets" },
  args: {
    ref: {
      type: "positional",
      description:
        "figma URL, fileKey:nodeId, or fileKey (pass several, or comma-separate ids, to batch)",
      required: true,
    },
    format: { type: "string", description: "png | svg | jpg | pdf", default: "svg" },
    scale: { type: "string", description: "export scale (e.g. 2)" },
    description: {
      type: "string",
      description: "what this asset is (index.md + <img alt>); e.g. the layer's purpose",
    },
    entity: {
      type: "string",
      description: 'entity name for media-use cache lookups (e.g. "Acme logo")',
    },
    dir: { type: "string", description: "project directory", default: "." },
  },
  async run({ args }) {
    await withFigmaErrors("figma:asset", async () => {
      const t0 = Date.now();
      const token = process.env.FIGMA_TOKEN ?? "";
      const client = createFigmaClient({ token });
      // citty puts ALL positionals in `args._` (including the one bound to the
      // named `ref`), so use `_` as the source of truth — reading both would
      // double-count the first. Split any comma-joined ids, so `asset A B`,
      // `asset A,B`, and `asset URL1 URL2` all batch into ONE /v1/images call.
      const positionals = (
        Array.isArray(args._) && args._.length > 0 ? (args._ as string[]) : [args.ref]
      ).map(String);
      const refs = gatherAssetRefs(positionals);
      const results = await runAssetImportMany(
        refs,
        {
          format: parseFormat(args.format),
          scale: args.scale !== undefined ? Number(args.scale) : undefined,
          description: args.description,
          entity: args.entity,
        },
        { projectDir: args.dir, client, download: downloadRender },
      );
      for (const result of results) {
        const verb = result.reused ? "reused" : "imported";
        console.log(`${verb} ${result.record.id} → ${result.record.path}`);
        console.log(result.snippet.html);
      }
      if (results.length > 1) {
        const rendered = results.filter((r) => !r.reused).length;
        console.log(
          rendered > 0
            ? `(${results.length} nodes, ${rendered} rendered in 1 figma request)`
            : `(${results.length} nodes, all reused from cache — no figma request)`,
        );
      }
      const { trackFigmaImport } = await import("../../telemetry/index.js");
      trackFigmaImport({
        phase: "asset",
        reused: results.every((r) => r.reused),
        durationMs: Date.now() - t0,
      });
    });
  },
});
