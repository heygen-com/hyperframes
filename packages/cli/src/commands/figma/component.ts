/**
 * `hyperframes figma component <ref>` — Phase 3: node tree → editable HTML
 * component with the §7.1 binding pass, per-node rasterize fallback via
 * Phase-1 asset import, packaged as a registry item.
 */

import { defineCommand } from "citty";
import {
  createFigmaClient,
  FigmaClientError,
  nodeToHtml,
  parseFigmaRef,
  readBindings,
  resolveBindings,
  slugify,
  type BindingSite,
  type FigmaClient,
  type NodeToHtmlResult,
  type RasterizeRequest,
} from "@hyperframes/core/figma";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
import { runAssetImport, type AssetImportResult } from "./asset.js";
import { downloadRender } from "./download.js";
import { withFigmaErrors } from "./cliError.js";

export interface ComponentImportDeps {
  projectDir: string;
  client: FigmaClient;
  download: (url: string) => Promise<Uint8Array>;
  /** override the component name — figma variant frames are often all named
   * "Platform=Desktop", which would slug-collide across imports */
  name?: string;
}

export interface ComponentImportResult {
  name: string;
  htmlPath: string;
  unresolved: BindingSite[];
  rasterized: RasterizeRequest[];
  /** node ids figma refused to render as svg AND png — placeholders shipped without src */
  failedRasterize: string[];
}

export async function runComponentImport(
  refInput: string,
  deps: ComponentImportDeps,
): Promise<ComponentImportResult> {
  const ref = parseFigmaRef(refInput);
  if (!ref.nodeId) throw new Error(`ref "${refInput}" has no node id`);

  const tree = await deps.client.nodeTree(ref);
  const bindings = resolveBindings(tree, readBindings(deps.projectDir));
  const mapped = nodeToHtml(tree, bindings, { rootName: deps.name });

  const name = slugify(deps.name ?? tree.name);
  const componentDir = join(deps.projectDir, "compositions", "components", name);
  if (existsSync(componentDir))
    console.warn(
      `component dir compositions/components/${name} already exists — overwriting (rename the figma frame for a separate import)`,
    );
  mkdirSync(componentDir, { recursive: true });

  const { html, frozenAssets, failedRasterize } = await rasterizeFallback(
    mapped,
    ref.fileKey,
    componentDir,
    deps,
  );

  const htmlFile = join(componentDir, `${name}.html`);
  writeFileSync(htmlFile, html + "\n");

  const registryItem = {
    name,
    type: "hyperframes:component",
    description: `Imported from figma ${ref.fileKey}/${ref.nodeId}`,
    files: [
      {
        path: `${name}.html`,
        target: `compositions/components/${name}/${name}.html`,
        type: "hyperframes:snippet",
      },
      // The paths the frozen files ACTUALLY landed at (image_NNN.svg), which
      // is also what the emitted HTML references — not the slug names.
      ...frozenAssets.map((p) => ({
        path: p.split("/").pop() ?? p,
        target: p.replaceAll("\\", "/"),
        type: "hyperframes:asset",
      })),
    ],
  };
  writeFileSync(
    join(componentDir, "registry-item.json"),
    JSON.stringify(registryItem, null, 2) + "\n",
  );

  return {
    name,
    htmlPath: relative(deps.projectDir, htmlFile),
    unresolved: bindings.unresolved,
    rasterized: mapped.rasterize,
    failedRasterize,
  };
}

interface RasterizeOutcome {
  html: string;
  frozenAssets: string[];
  failedRasterize: string[];
}

/**
 * Rasterize fallback: export each unmappable node via Phase 1 and point the
 * placeholder img at the frozen file (path relative to the component). figma
 * sometimes refuses to render a node (nested instances commonly fail as svg)
 * — retry once as png, then skip THAT node and keep the import: one
 * unrenderable node must not abort the whole component. Skipped placeholders
 * keep their data-figma-rasterize marker (no src) so the gap is visible.
 */
async function rasterizeFallback(
  mapped: NodeToHtmlResult,
  fileKey: string,
  componentDir: string,
  deps: ComponentImportDeps,
): Promise<RasterizeOutcome> {
  let html = mapped.html;
  const frozenAssets: string[] = [];
  const failedRasterize: string[] = [];
  for (const req of mapped.rasterize) {
    const asset = await renderWithPngRetry(fileKey, req, deps);
    if (asset === null) {
      failedRasterize.push(req.nodeId);
      console.warn(
        `could not render node ${req.nodeId} ("${req.name}") as svg or png — leaving its placeholder without src`,
      );
      continue;
    }
    frozenAssets.push(asset.record.path);
    // src is a URL — always forward slashes, even when relative() yields
    // windows separators.
    const srcRel = relative(componentDir, join(deps.projectDir, asset.record.path)).replaceAll(
      "\\",
      "/",
    );
    // The search key must match the EMITTED (html-escaped) node id, and
    // replaceAll covers the same node appearing twice in the tree.
    const emittedId = escapeAttr(req.nodeId);
    html = html.replaceAll(
      `data-figma-rasterize="${emittedId}" `,
      `data-figma-rasterize="${emittedId}" src="${escapeAttr(srcRel)}" `,
    );
  }
  return { html, frozenAssets, failedRasterize };
}

async function renderWithPngRetry(
  fileKey: string,
  req: RasterizeRequest,
  deps: ComponentImportDeps,
): Promise<AssetImportResult | null> {
  for (const format of ["svg", "png"] as const) {
    try {
      return await runAssetImport(
        `${fileKey}:${req.nodeId}`,
        { format, description: req.name },
        { projectDir: deps.projectDir, client: deps.client, download: deps.download },
      );
    } catch (err) {
      if (!(err instanceof FigmaClientError) || err.code !== "RENDER_FAILED") throw err;
    }
  }
  return null;
}

export default defineCommand({
  meta: { name: "component", description: "Import a figma frame as an editable HTML component" },
  args: {
    ref: { type: "positional", description: "figma URL or fileKey:nodeId", required: true },
    name: {
      type: "string",
      description: "component name override (variant frames often share a name and would collide)",
    },
    dir: { type: "string", description: "project directory", default: "." },
  },
  async run({ args }) {
    await withFigmaErrors("figma:component", async () => {
      const t0 = Date.now();
      const client = createFigmaClient({ token: process.env.FIGMA_TOKEN ?? "" });
      const result = await runComponentImport(args.ref, {
        projectDir: args.dir,
        client,
        download: downloadRender,
        name: args.name,
      });
      console.log(`imported component "${result.name}" → ${result.htmlPath}`);
      if (result.rasterized.length > 0) {
        const ok = result.rasterized.length - result.failedRasterize.length;
        console.log(
          result.failedRasterize.length > 0
            ? `rasterized ${ok}/${result.rasterized.length} node(s) via asset export — ${result.failedRasterize.length} skipped (unrenderable; placeholders have no src)`
            : `rasterized ${result.rasterized.length} node(s) via asset export`,
        );
      }
      if (result.unresolved.length > 0) {
        console.log(
          `${result.unresolved.length} binding(s) reference tokens not yet imported — colors baked as literals (flagged data-figma-unresolved). Run \`hyperframes figma tokens\` on the source/library file, then re-import to link them.`,
        );
      }
      const { trackFigmaImport } = await import("../../telemetry/index.js");
      trackFigmaImport({
        phase: "component",
        unresolvedBindings: result.unresolved.length,
        rasterizedNodes: result.rasterized.length,
        rasterizeFailures: result.failedRasterize.length,
        durationMs: Date.now() - t0,
      });
    });
  },
});
