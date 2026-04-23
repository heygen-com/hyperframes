import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

const ARTIFACT_NAMES = ["hyperframe-runtime.js", "hyperframe.runtime.iife.js"];

/**
 * Resolve the runtime JS source for the studio preview server.
 *
 * Three resolution strategies, in priority order:
 *
 *   1. esbuild from source (dev only — gated on entry.ts existence)
 *   2. Inlined constant    (production — baked into @hyperframes/core at build time)
 *   3. Pre-built artifact  (fallback — reads IIFE file from dist/)
 */
export async function loadRuntimeSource(): Promise<string | null> {
  return (await buildFromSource()) ?? (await getInlinedRuntime()) ?? readPrebuiltArtifact();
}

// ── Strategy 1: live build from source (dev only) ──────────────────────────

const ENTRY_TS = resolve(__dirname, "..", "..", "..", "core", "src", "runtime", "entry.ts");

async function buildFromSource(): Promise<string | null> {
  if (!existsSync(ENTRY_TS)) return null;
  try {
    const mod = await import("@hyperframes/core");
    if (typeof mod.loadHyperframeRuntimeSource === "function") {
      const source = mod.loadHyperframeRuntimeSource();
      if (source) return source;
    }
  } catch {
    // esbuild failed — fall through to inlined / artifact
  }
  return null;
}

// ── Strategy 2: inlined constant from core build ──────────────────────────

async function getInlinedRuntime(): Promise<string | null> {
  try {
    const mod = await import("@hyperframes/core");
    if (typeof mod.getHyperframeRuntimeScript === "function") {
      return mod.getHyperframeRuntimeScript() ?? null;
    }
  } catch {
    // Not available — fall through to artifact
  }
  return null;
}

// ── Strategy 3: pre-built IIFE artifact ───────────────────────────────────

function readPrebuiltArtifact(): string | null {
  return readFromDir(__dirname) ?? readFromCoreDistDir() ?? readFromNodeModules();
}

function readFromDir(dir: string): string | null {
  for (const name of ARTIFACT_NAMES) {
    const path = resolve(dir, name);
    if (existsSync(path)) return readFileSync(path, "utf-8");
  }
  return null;
}

function readFromCoreDistDir(): string | null {
  return readFromDir(resolve(__dirname, "..", "..", "..", "core", "dist"));
}

function readFromNodeModules(): string | null {
  const subPaths = ["node_modules/hyperframes/dist", "node_modules/@hyperframes/core/dist"];
  let dir = __dirname;
  for (;;) {
    for (const sub of subPaths) {
      const result = readFromDir(resolve(dir, sub));
      if (result) return result;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
