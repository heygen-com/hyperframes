import AdmZip from "adm-zip";
import { join } from "path";
import { mkdirSync, writeFileSync } from "fs";

export interface ExtractResult {
  success: boolean;
  error?: string;
}

/**
 * Extract a ZIP buffer into the target directory.
 * Validates that index.html exists at root or inside a single wrapper directory.
 * If there's a single wrapper dir, flattens it so index.html ends up at the project root.
 */
/** Returns true if the entry is OS junk or a hidden file */
function isHiddenEntry(entryName: string): boolean {
  if (entryName.startsWith("__MACOSX")) return true;
  return entryName.split("/").some((seg) => seg.startsWith("."));
}

export function extractZip(
  buffer: Buffer,
  targetDir: string,
): ExtractResult {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries().filter((e) => !isHiddenEntry(e.entryName));

  if (entries.length === 0) {
    return { success: false, error: "ZIP file is empty" };
  }

  // Check if index.html exists at root
  const hasRootIndex = entries.some(
    (e) => e.entryName === "index.html" && !e.isDirectory,
  );

  // If no index.html, check if there's a single .html file at root we can use
  let renameToIndex: string | null = null;
  if (!hasRootIndex) {
    const rootHtmlFiles = entries.filter(
      (e) =>
        !e.isDirectory &&
        !e.entryName.includes("/") &&
        e.entryName.endsWith(".html"),
    );
    if (rootHtmlFiles.length === 1) {
      renameToIndex = rootHtmlFiles[0]?.entryName ?? null;
    }
  }

  // Check for single wrapper directory pattern (e.g., "project/index.html")
  let stripPrefix = "";
  if (!hasRootIndex && !renameToIndex) {
    const topLevelDirs = new Set<string>();
    for (const entry of entries) {
      const firstSlash = entry.entryName.indexOf("/");
      if (firstSlash > 0) {
        topLevelDirs.add(entry.entryName.slice(0, firstSlash));
      }
    }

    if (topLevelDirs.size === 1) {
      const wrapperDir = [...topLevelDirs][0] ?? "";
      const hasNestedIndex = entries.some(
        (e) =>
          e.entryName === `${wrapperDir}/index.html` && !e.isDirectory,
      );
      if (hasNestedIndex) {
        stripPrefix = `${wrapperDir}/`;
      } else {
        // Check for single .html in wrapper dir
        const nestedHtmlFiles = entries.filter(
          (e) =>
            !e.isDirectory &&
            e.entryName.startsWith(`${wrapperDir}/`) &&
            !e.entryName.slice(wrapperDir.length + 1).includes("/") &&
            e.entryName.endsWith(".html"),
        );
        if (nestedHtmlFiles.length === 1) {
          stripPrefix = `${wrapperDir}/`;
          renameToIndex = nestedHtmlFiles[0]?.entryName.slice(stripPrefix.length) ?? null;
        } else {
          const found = entries
            .filter((e) => !e.isDirectory)
            .map((e) => e.entryName)
            .join(", ");
          return {
            success: false,
            error: `ZIP must contain index.html (or a single .html file). Found: ${found}`,
          };
        }
      }
    } else {
      const found = entries
        .filter((e) => !e.isDirectory)
        .map((e) => e.entryName)
        .join(", ");
      return {
        success: false,
        error: `ZIP must contain index.html (or a single .html file). Found: ${found}`,
      };
    }
  }

  // Extract files
  for (const entry of entries) {
    let relativePath = entry.entryName;

    // Strip wrapper directory prefix if needed
    if (stripPrefix && relativePath.startsWith(stripPrefix)) {
      relativePath = relativePath.slice(stripPrefix.length);
    } else if (stripPrefix) {
      continue; // Skip files outside the wrapper (e.g., __MACOSX)
    }

    if (!relativePath || relativePath === "/") continue;

    // Directory traversal protection
    if (relativePath.includes("..")) continue;

    // Rename single .html file to index.html
    if (renameToIndex && relativePath === renameToIndex) {
      relativePath = "index.html";
    }

    const fullPath = join(targetDir, relativePath);

    if (entry.isDirectory) {
      mkdirSync(fullPath, { recursive: true });
    } else {
      const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
      mkdirSync(dir, { recursive: true });
      writeFileSync(fullPath, entry.getData());
    }
  }

  return { success: true };
}
