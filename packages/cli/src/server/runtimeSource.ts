import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

/**
 * Candidate filenames for the pre-built runtime IIFE artifact.
 * The build copies core's IIFE output into cli/dist under both names.
 */
const RUNTIME_FILENAMES = ["hyperframe-runtime.js", "hyperframe.runtime.iife.js"];

/**
 * Walk up from `startDir` looking for the runtime artifact inside
 * `node_modules/hyperframes/dist/` or `node_modules/@hyperframes/core/dist/`.
 * Stops at the filesystem root.
 */
function findRuntimeInNodeModules(startDir: string): string | null {
  const subPaths = [
    "node_modules/hyperframes/dist/hyperframe-runtime.js",
    "node_modules/@hyperframes/core/dist/hyperframe.runtime.iife.js",
  ];

  let dir = startDir;
  for (;;) {
    for (const sub of subPaths) {
      const candidate = resolve(dir, sub);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break; // reached root
    dir = parent;
  }
  return null;
}

/**
 * Try to locate and read the pre-built IIFE runtime artifact on disk.
 * Returns the JS source string or null if not found.
 */
function readPrebuiltRuntime(): string | null {
  // 1. Check alongside the bundled CLI (dist/hyperframe-runtime.js etc.)
  for (const name of RUNTIME_FILENAMES) {
    const candidate = resolve(__dirname, name);
    if (existsSync(candidate)) {
      return readFileSync(candidate, "utf-8");
    }
  }

  // 2. Walk up from __dirname looking inside node_modules
  const fromNodeModules = findRuntimeInNodeModules(__dirname);
  if (fromNodeModules) {
    return readFileSync(fromNodeModules, "utf-8");
  }

  return null;
}

export async function loadRuntimeSourceFallback(): Promise<string | null> {
  // Primary: dynamically import @hyperframes/core and build via esbuild.
  // In dev this produces a live build from source. In the bundled CLI,
  // import.meta.url inside the inlined core code resolves to cli.js,
  // making the entry.ts path invalid — so this fails for global installs.
  try {
    const mod = await import("@hyperframes/core");
    if (typeof mod.loadHyperframeRuntimeSource === "function") {
      return mod.loadHyperframeRuntimeSource();
    }
  } catch {
    // Expected in bundled context — fall through to pre-built artifact.
  }

  // Fallback: read the pre-built IIFE artifact from disk. This covers the
  // globally-installed case where esbuild cannot resolve source files.
  const prebuilt = readPrebuiltRuntime();
  if (prebuilt) return prebuilt;

  console.warn(
    "[studio] Could not load runtime source. Neither the esbuild build path " +
      "nor a pre-built runtime artifact (hyperframe-runtime.js) could be found. " +
      "Try rebuilding with: bun run build",
  );
  return null;
}
