/**
 * Project scaffolding helpers for the website capture pipeline.
 *
 * Handles .env file loading and HyperFrames project scaffold generation
 * (index.html, meta.json, AGENTS.md, CLAUDE.md).
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { applyDotEnv } from "../utils/dotEnv.js";
import { writeNewFileSync } from "../utils/writeNewFile.js";
import type { CatalogedAsset } from "./assetCataloger.js";
import type { CaptureResult, DesignTokens } from "./types.js";

/**
 * Load .env file by walking up from startDir (up to 5 levels).
 * Sets process.env keys that are not already set. Best-effort — never throws.
 */
export function loadEnvFile(startDir: string): void {
  try {
    let dir = resolve(startDir);
    for (let i = 0; i < 5; i++) {
      const envPath = resolve(dir, ".env");
      try {
        applyDotEnv(readFileSync(envPath, "utf-8"), process.env);
        break;
      } catch {
        dir = resolve(dir, "..");
      }
    }
  } catch {
    /* .env loading is best-effort */
  }
}

/**
 * Generate the project scaffold files: index.html, meta.json, AGENTS.md, CLAUDE.md.
 *
 * Only creates files that don't already exist (index.html, meta.json).
 * Always (re)generates AGENTS.md + CLAUDE.md via agentPromptGenerator.
 */
export async function generateProjectScaffold(
  outputDir: string,
  url: string,
  tokens: DesignTokens,
  animationCatalog: CaptureResult["animationCatalog"],
  hasScreenshots: boolean,
  hasLotties: boolean,
  hasShaders: boolean,
  catalogedAssets: CatalogedAsset[],
  progress: (stage: string, detail?: string) => void,
  warnings: string[],
  detectedLibraries?: string[],
): Promise<void> {
  // Capture output is a DATA folder, not a video project.
  // The agent builds index.html + compositions/ during step 6.
  // We only write meta.json (project metadata) — NOT index.html.
  // Writing index.html here caused a double-audio bug: the runtime
  // discovered both the scaffold and the agent's real index.html as
  // valid compositions, playing two audio tracks offset in time.
  const metaPath = join(outputDir, "meta.json");
  if (!existsSync(metaPath)) {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    writeNewFileSync(
      metaPath,
      JSON.stringify({ id: hostname + "-video", name: tokens.title || hostname }, null, 2),
    );
  }

  // Generate AGENTS.md + CLAUDE.md (AI agent instructions — always, regardless of API keys)
  try {
    const { generateAgentPrompt } = await import("./agentPromptGenerator.js");
    generateAgentPrompt(
      outputDir,
      url,
      tokens,
      animationCatalog,
      hasScreenshots,
      hasLotties,
      hasShaders,
      catalogedAssets,
      detectedLibraries,
    );
    progress("agent", "AGENTS.md + CLAUDE.md generated");
  } catch (err) {
    warnings.push(`AGENTS.md/CLAUDE.md generation failed: ${err}`);
  }
}
