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
  findByFigmaNode,
  freezeBytes,
  nextId,
  parseFigmaRef,
  sanitizeSvg,
  typeDirPath,
  type AssetSnippet,
  type FigmaAssetFormat,
  type FigmaClient,
  type FigmaManifestRecord,
} from "@hyperframes/core/figma";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { downloadRender } from "./download.js";

export interface AssetImportOptions {
  format: FigmaAssetFormat;
  scale?: number;
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

  // Cache key per spec §5: fileKey:nodeId:format:scale:version → reuse.
  // Unspecified scale is canonically 1 on both sides (figma's default), so
  // `--scale 1` and no flag dedupe to the same record. Reuse also requires
  // the frozen file to still exist — a deleted file falls through to
  // re-import instead of returning a snippet that points at nothing.
  const existing = findByFigmaNode(deps.projectDir, ref.fileKey, ref.nodeId);
  if (
    existing &&
    existing.provenance.format === opts.format &&
    (existing.provenance.scale ?? 1) === (opts.scale ?? 1) &&
    existing.provenance.version === version &&
    existsSync(join(deps.projectDir, existing.path))
  ) {
    return { record: existing, snippet: buildAssetSnippet(existing), reused: true };
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
  return { record, snippet: buildAssetSnippet(record), reused: false };
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
    dir: { type: "string", description: "project directory", default: "." },
  },
  async run({ args }) {
    const token = process.env.FIGMA_TOKEN ?? "";
    const client = createFigmaClient({ token });
    const result = await runAssetImport(
      args.ref,
      {
        format: parseFormat(args.format),
        scale: args.scale !== undefined ? Number(args.scale) : undefined,
      },
      { projectDir: args.dir, client, download: downloadRender },
    );
    const verb = result.reused ? "reused" : "imported";
    console.log(`${verb} ${result.record.id} → ${result.record.path}`);
    console.log(result.snippet.html);
  },
});
