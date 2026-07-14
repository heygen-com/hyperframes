/**
 * `hyperframes figma tokens <fileKey>` — Phase 2: import figma variables as
 * composition brand-variable entries + figma-tokens.json sidecar + binding
 * index records. Variables are Enterprise-gated upstream; degrades to a
 * styles-metadata listing on REQUIRES_ENTERPRISE (style *values* resolve at
 * component-import time, Phase 3).
 */

import { defineCommand } from "citty";
import {
  createFigmaClient,
  FigmaClientError,
  parseFigmaRef,
  tokensToVariables,
  upsertBindings,
  type CompositionVariableEntry,
  type FigmaClient,
  type FigmaTokensSidecar,
} from "@hyperframes/core/figma";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { withFigmaErrors } from "./cliError.js";

export interface TokensImportDeps {
  projectDir: string;
  client: FigmaClient;
}

export interface TokensImportResult {
  mode: "variables" | "styles";
  entries: CompositionVariableEntry[];
  sidecarPath: string;
  /** styles mode only: how many published styles were actually found —
   * entries is always [] in this mode (style values resolve later, at
   * component-import time), so this is what tells success from empty. */
  styleCount?: number;
}

export async function runTokensImport(
  refInput: string,
  deps: TokensImportDeps,
): Promise<TokensImportResult> {
  const { fileKey } = parseFigmaRef(refInput);
  const { version } = await deps.client.fileVersion(fileKey);
  const sidecarPath = join(deps.projectDir, "figma-tokens.json");

  // Only the variables() call may trigger the styles fallback — a translator
  // or write failure must propagate, not silently rerun as a styles import.
  let vars = null;
  try {
    vars = await deps.client.variables(fileKey);
  } catch (err) {
    if (!(err instanceof FigmaClientError) || err.code !== "REQUIRES_ENTERPRISE") throw err;
  }
  if (vars !== null) {
    const out = tokensToVariables(vars, { fileKey, version });
    upsertBindings(deps.projectDir, out.bindings);
    writeFileSync(sidecarPath, JSON.stringify(out.sidecar, null, 2) + "\n");
    return { mode: "variables", entries: out.entries, sidecarPath };
  }

  // Styles fallback: metadata only — values resolve at component-import time.
  const styles = await deps.client.styles(fileKey);
  const sidecar: FigmaTokensSidecar = {
    source: { fileKey, version },
    tokens: styles.map((s) => ({
      name: s.name,
      type: `style:${s.style_type}`,
      figmaId: s.node_id ?? s.key,
      key: s.key,
      value: null,
    })),
  };
  writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2) + "\n");
  return { mode: "styles", entries: [], sidecarPath, styleCount: styles.length };
}

export default defineCommand({
  meta: { name: "tokens", description: "Import figma variables/styles as brand tokens" },
  args: {
    ref: { type: "positional", description: "figma fileKey or URL", required: true },
    dir: { type: "string", description: "project directory", default: "." },
  },
  async run({ args }) {
    await withFigmaErrors("figma:tokens", async () => {
      const t0 = Date.now();
      const client = createFigmaClient({ token: process.env.FIGMA_TOKEN ?? "" });
      const result = await runTokensImport(args.ref, { projectDir: args.dir, client });
      if (result.mode === "styles") {
        console.log(
          (result.styleCount ?? 0) > 0
            ? `variables are Enterprise-gated on this plan — recorded ${result.styleCount} published style(s) instead (style values resolve at component-import time)`
            : "variables are Enterprise-gated on this plan, and this file has no published library styles to fall back to — nothing recorded. Publish the file's styles to a team library, or read variables via the Figma MCP connector's get_variable_defs instead (works on any plan, rate-limited).",
        );
      }
      console.log(`wrote ${result.sidecarPath} (${result.mode})`);
      if (result.entries.length > 0) {
        console.log("add to data-composition-variables:");
        console.log(JSON.stringify(result.entries, null, 2));
      }
      const { trackFigmaImport } = await import("../../telemetry/index.js");
      trackFigmaImport({
        phase: "tokens",
        tokensMode: result.mode,
        entryCount: result.entries.length,
        durationMs: Date.now() - t0,
      });
    });
  },
});
