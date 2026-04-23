import { buildSync } from "esbuild";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type HyperframesRuntimeBuildOptions = {
  sourceUrl?: string;
  defaultParityMode?: boolean;
  minify?: boolean;
};

function applyDefaultParityMode(script: string, enabled: boolean): string {
  const parityFlagPattern = /var\s+_parityModeEnabled\s*=\s*(?:true|false)\s*;/;
  if (!parityFlagPattern.test(script)) return script;
  return script.replace(
    parityFlagPattern,
    `var _parityModeEnabled = ${enabled ? "true" : "false"};`,
  );
}

/**
 * Build the runtime IIFE from source via esbuild.
 *
 * Returns `null` when `entry.ts` does not exist at the resolved path —
 * this happens in bundled / published contexts where only `dist/` ships.
 * Callers must fall back to the pre-built artifact or the inlined constant.
 */
export function buildHyperframesRuntimeScript(
  options: HyperframesRuntimeBuildOptions = {},
): string | null {
  const entryPath = resolve(dirname(fileURLToPath(import.meta.url)), "../runtime/entry.ts");
  if (!existsSync(entryPath)) return null;

  const result = buildSync({
    entryPoints: [entryPath],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    target: ["es2020"],
    minify: options.minify ?? true,
    legalComments: "none",
  });
  let script = result.outputFiles[0]?.text ?? "";
  if (typeof options.defaultParityMode === "boolean") {
    script = applyDefaultParityMode(script, options.defaultParityMode);
  }
  if (options.sourceUrl && options.sourceUrl.trim()) {
    script = `${script}\n//# sourceURL=${options.sourceUrl.trim()}`;
  }
  return script;
}
