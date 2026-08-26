/**
 * The fallback for browsers that have not shipped WebMCP.
 *
 * `@mcp-b/global` does two things: it defines `document.modelContext`, and it
 * stands up an in-page MCP server for a bridge extension to attach to. The
 * second is the reason this is the chosen package over the bare
 * `@mcp-b/webmcp-polyfill`: without the server there is nothing for an
 * out-of-browser agent to connect to, which is the only case the fallback
 * exists to serve.
 *
 * It is a DYNAMIC import so a browser with native support never downloads it,
 * and so it lands in its own chunk rather than the entry bundle.
 */

import { makeStudioDebugLogger } from "../utils/studioDebug";
import { getModelContext, type ModelContext } from "./types";

const log = makeStudioDebugLogger("webmcp");

/**
 * Module-level, so two mounts racing (React StrictMode, or a remount during
 * the import) share one load instead of pulling the package twice.
 */
let pending: Promise<ModelContext | null> | null = null;

async function importPolyfill(): Promise<ModelContext | null> {
  try {
    await import("@mcp-b/global");
    const modelContext = getModelContext();
    if (!modelContext) {
      // The package loaded but did not define what it promises to define.
      log("polyfill", { loaded: true, modelContext: false });
    }
    return modelContext;
  } catch (error) {
    // A missing agent surface must never break Studio's boot.
    log("polyfill", { failed: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

export function loadModelContextPolyfill(): Promise<ModelContext | null> {
  pending ??= importPolyfill();
  return pending;
}

/** Test seam. Nothing in production resets this. */
export function resetModelContextPolyfillForTest(): void {
  pending = null;
}
