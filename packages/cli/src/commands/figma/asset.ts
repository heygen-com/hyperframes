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

export async function runAssetImport(
  refInput: string,
  opts: AssetImportOptions,
  deps: AssetImportDeps,
): Promise<AssetImportResult> {
  const ref = parseFigmaRef(refInput);
  if (!ref.nodeId)
    throw new Error(
      `ref "${refInput}" has no node id — share a link with ?node-id=… or use fileKey:nodeId`,
    );

  const { version } = await deps.client.fileVersion(ref.fileKey);
  const description = normalizeMeta(opts.description);
  const entity = normalizeMeta(opts.entity);

  // Cache key per spec §5: fileKey:nodeId:format:scale:version → reuse.
  // Check EVERY row for the node (a node can legitimately have several
  // format/scale/version tuples — the oldest-row shortcut minted duplicates
  // forever once a second tuple existed). Unspecified scale is canonically 1
  // on both sides (figma's default). Reuse also requires the frozen file to
  // still exist — a deleted file falls through to re-import.
  const existing = findAllByFigmaNode(deps.projectDir, ref.fileKey, ref.nodeId).find(
    (r) =>
      r.provenance.format === opts.format &&
      (r.provenance.scale ?? 1) === (opts.scale ?? 1) &&
      r.provenance.version === version &&
      existsSync(join(deps.projectDir, r.path)),
  );
  if (existing) {
    // Metadata supplied on a re-import still lands: upsert the row instead
    // of silently discarding the flags.
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
    safeRegenerateIndex(deps.projectDir);
    return { record, snippet: buildAssetSnippet(record), reused: true };
  }

  const rendered = await deps.client.renderNode(ref, opts);
  let bytes = await deps.download(rendered.url);
  if (rendered.ext === "svg") {
    // Sniff before decoding: an SVG starts with '<' or an XML decl/BOM. A
    // non-text payload would decode to U+FFFD soup and still write to disk.
    const b0 = bytes[0];
    if (b0 !== 0x3c && b0 !== 0x3f && b0 !== 0xef)
      throw new Error("figma render returned non-SVG bytes for an svg export — retry the import");
    bytes = new TextEncoder().encode(sanitizeSvg(new TextDecoder().decode(bytes)));
  }

  const id = nextId(deps.projectDir, "image");
  const destAbs = join(typeDirPath(deps.projectDir, "image"), `${id}.${rendered.ext}`);
  freezeBytes(bytes, destAbs);

  const record: FigmaManifestRecord = {
    id,
    type: "image",
    path: relative(deps.projectDir, destAbs),
    source: `figma:${ref.fileKey}/${ref.nodeId}`,
    ...(description !== undefined && { description }),
    ...(entity !== undefined && { entity }),
    provenance: {
      source: "figma",
      fileKey: ref.fileKey,
      nodeId: ref.nodeId,
      version,
      format: opts.format,
      scale: opts.scale,
    },
  };
  appendRecord(deps.projectDir, record);
  safeRegenerateIndex(deps.projectDir);
  return { record, snippet: buildAssetSnippet(record), reused: false };
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
  meta: { name: "asset", description: "Import a figma node as a frozen local asset" },
  args: {
    ref: {
      type: "positional",
      description: "figma URL, fileKey:nodeId, or fileKey",
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
    await withFigmaErrors(async () => {
      const token = process.env.FIGMA_TOKEN ?? "";
      const client = createFigmaClient({ token });
      const result = await runAssetImport(
        args.ref,
        {
          format: parseFormat(args.format),
          scale: args.scale !== undefined ? Number(args.scale) : undefined,
          description: args.description,
          entity: args.entity,
        },
        { projectDir: args.dir, client, download: downloadRender },
      );
      const verb = result.reused ? "reused" : "imported";
      console.log(`${verb} ${result.record.id} → ${result.record.path}`);
      console.log(result.snippet.html);
    });
  },
});
