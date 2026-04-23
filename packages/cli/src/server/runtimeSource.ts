import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

const ARTIFACT_NAMES = ["hyperframe-runtime.js", "hyperframe.runtime.iife.js"];

/**
 * Resolve the runtime JS source for the studio preview server.
 *
 * Two contexts exist:
 *
 *   Dev (monorepo workspace) — `entry.ts` exists next to `@hyperframes/core`
 *   source. We build from source via esbuild so edits to the runtime are
 *   reflected without a manual `bun run build`.
 *
 *   Installed (npm global / npx) — only `dist/` ships. We read the pre-built
 *   IIFE artifact that `build:runtime` copies alongside `cli.js`.
 *
 * The priority chain:
 *   1. esbuild from source  (dev only — gated on entry.ts existence)
 *   2. pre-built artifact    (alongside cli.js in dist/)
 *   3. core/dist artifact    (dev fallback if build:runtime already ran)
 *   4. node_modules walk     (nested install edge cases)
 */
export async function loadRuntimeSource(): Promise<string | null> {
  return (await buildFromSource()) ?? readPrebuiltArtifact();
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
    // esbuild failed — fall through to artifact
  }
  return null;
}

// ── Strategy 2-4: pre-built IIFE artifact ──────────────────────────────────

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
