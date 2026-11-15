import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function hyperframesCacheDir(...parts: string[]): string {
  const named = process.env["HYPERFRAMES_CACHE_DIR"];
  return join(named ? resolve(named) : join(homedir(), ".cache", "hyperframes"), ...parts);
}

export function namedCacheDir(...parts: string[]): string | undefined {
  return process.env["HYPERFRAMES_CACHE_DIR"] ? hyperframesCacheDir(...parts) : undefined;
}
