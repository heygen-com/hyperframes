import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Node resolves symlinks in the main module's import.meta.url but argv[1] keeps the invoked
// spelling (a symlinked skills dir, or /tmp vs /private/tmp on macOS), so compare real paths.
export function isMainModule(importMetaUrl) {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href === importMetaUrl;
  } catch {
    return false;
  }
}
