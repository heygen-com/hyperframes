/**
 * `hyperframes figma component <ref>` — Phase 3: node tree → editable HTML
 * component with the §7.1 binding pass, per-node rasterize fallback via
 * Phase-1 asset import, packaged as a registry item.
 */

import { defineCommand } from "citty";
import {
  createFigmaClient,
  nodeToHtml,
  parseFigmaRef,
  readBindings,
  resolveBindings,
  slugify,
  type BindingSite,
  type FigmaClient,
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
import { runAssetImport } from "./asset.js";
import { downloadRender } from "./download.js";
import { withFigmaErrors } from "./cliError.js";

export interface ComponentImportDeps {
  projectDir: string;
  client: FigmaClient;
  download: (url: string) => Promise<Uint8Array>;
}

export interface ComponentImportResult {
  name: string;
  htmlPath: string;
  unresolved: BindingSite[];
  rasterized: RasterizeRequest[];
}

export async function runComponentImport(
  refInput: string,
  deps: ComponentImportDeps,
): Promise<ComponentImportResult> {
  const ref = parseFigmaRef(refInput);
  if (!ref.nodeId) throw new Error(`ref "${refInput}" has no node id`);

  const tree = await deps.client.nodeTree(ref);
  const bindings = resolveBindings(tree, readBindings(deps.projectDir));
  const mapped = nodeToHtml(tree, bindings);

  const name = slugify(tree.name);
  const componentDir = join(deps.projectDir, "compositions", "components", name);
  if (existsSync(componentDir))
    console.warn(
      `component dir compositions/components/${name} already exists — overwriting (rename the figma frame for a separate import)`,
    );
  mkdirSync(componentDir, { recursive: true });

  // Rasterize fallback: export each unmappable node via Phase 1 and point
  // the placeholder img at the frozen file (path relative to the component).
  // The search key must match the EMITTED (html-escaped) node id, and
  // replaceAll covers the same node appearing twice in the tree.
  let html = mapped.html;
  for (const req of mapped.rasterize) {
    const asset = await runAssetImport(
      `${ref.fileKey}:${req.nodeId}`,
      { format: "svg" },
      { projectDir: deps.projectDir, client: deps.client, download: deps.download },
    );
    // src is a URL — always forward slashes, even when relative() yields
    // windows separators.
    const srcRel = relative(componentDir, join(deps.projectDir, asset.record.path)).replaceAll(
      "\\",
      "/",
    );
    const emittedId = escapeAttr(req.nodeId);
    html = html.replaceAll(
      `data-figma-rasterize="${emittedId}" `,
      `data-figma-rasterize="${emittedId}" src="${escapeAttr(srcRel)}" `,
    );
  }

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
      ...mapped.rasterize.map((r) => ({
        path: `${r.slug}.svg`,
        target: `.media/images/${r.slug}.svg`,
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
  };
}

export default defineCommand({
  meta: { name: "component", description: "Import a figma frame as an editable HTML component" },
  args: {
    ref: { type: "positional", description: "figma URL or fileKey:nodeId", required: true },
    dir: { type: "string", description: "project directory", default: "." },
  },
  async run({ args }) {
    await withFigmaErrors(async () => {
      const client = createFigmaClient({ token: process.env.FIGMA_TOKEN ?? "" });
      const result = await runComponentImport(args.ref, {
        projectDir: args.dir,
        client,
        download: downloadRender,
      });
      console.log(`imported component "${result.name}" → ${result.htmlPath}`);
      if (result.rasterized.length > 0)
        console.log(`rasterized ${result.rasterized.length} node(s) via asset export`);
      if (result.unresolved.length > 0) {
        console.log(
          `${result.unresolved.length} binding(s) reference tokens not yet imported — colors baked as literals (flagged data-figma-unresolved). Run \`hyperframes figma tokens\` on the source/library file, then re-import to link them.`,
        );
      }
    });
  },
});
