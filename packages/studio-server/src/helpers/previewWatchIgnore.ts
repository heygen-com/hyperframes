import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

const CONFIG_FILE = "hyperframes.json";

export function normalizePreviewWatchIgnore(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    if (typeof entry !== "string") return [];
    const normalized = entry.replace(/\\/g, "/").replace(/^\.\//, "");
    let end = normalized.length;
    while (end > 0 && normalized[end - 1] === "/") end -= 1;
    const path = normalized.slice(0, end);
    if (
      !path ||
      path.startsWith("/") ||
      /[:*?[\]]/.test(path) ||
      path.split("/").some((part) => !part || part === "." || part === "..")
    ) {
      return [];
    }
    return [path];
  });
}

function readIgnoredPaths(projectDir: string): string[] {
  try {
    const config: unknown = JSON.parse(readFileSync(resolve(projectDir, CONFIG_FILE), "utf8"));
    if (!config || typeof config !== "object" || !("preview" in config)) return [];
    const preview = config.preview;
    if (!preview || typeof preview !== "object" || !("watchIgnore" in preview)) return [];
    return normalizePreviewWatchIgnore(preview.watchIgnore);
  } catch {
    return [];
  }
}

export function shouldReloadPreview(projectDir: string, changedPath: string): boolean {
  const path = relative(resolve(projectDir), resolve(projectDir, changedPath)).replace(/\\/g, "/");
  if (!path || path === ".." || path.startsWith("../") || isAbsolute(path)) return false;
  if (path === CONFIG_FILE) return true;
  const name = path.split("/").at(-1) ?? "";
  if (/\.tmp(?:\.\d+\.[a-f\d]+)?$/i.test(name) || /\.(?:swp|swo)$|~$/.test(name)) return false;
  return !readIgnoredPaths(projectDir).some(
    (ignored) => path === ignored || path.startsWith(`${ignored}/`),
  );
}
