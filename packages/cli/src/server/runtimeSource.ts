import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

const RUNTIME_FILENAMES = ["hyperframe-runtime.js", "hyperframe.runtime.iife.js"];

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
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function readPrebuiltRuntime(): string | null {
  for (const name of RUNTIME_FILENAMES) {
    const candidate = resolve(__dirname, name);
    if (existsSync(candidate)) {
      return readFileSync(candidate, "utf-8");
    }
  }

  const fromNodeModules = findRuntimeInNodeModules(__dirname);
  if (fromNodeModules) {
    return readFileSync(fromNodeModules, "utf-8");
  }

  return null;
}

function canBuildFromSource(): boolean {
  try {
    const entryPath = resolve(__dirname, "..", "..", "..", "core", "src", "runtime", "entry.ts");
    return existsSync(entryPath);
  } catch {
    return false;
  }
}

export async function loadRuntimeSourceFallback(): Promise<string | null> {
  if (canBuildFromSource()) {
    try {
      const mod = await import("@hyperframes/core");
      if (typeof mod.loadHyperframeRuntimeSource === "function") {
        const source = mod.loadHyperframeRuntimeSource();
        if (source) return source;
      }
    } catch {
      // esbuild failed even though source exists — fall through to artifact
    }
  }

  return readPrebuiltRuntime();
}
