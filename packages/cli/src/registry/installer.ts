/**
 * Registry installer — copies item files into a destination project.
 *
 * The top-level directory used under the source registry is determined by the
 * item's `type` (examples/blocks/components). Target paths are validated at
 * runtime to reject traversal even if the registry JSON schema was bypassed.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import type { FileTarget, RegistryItem } from "@hyperframes/core";
import { fetchItemFile, DEFAULT_REGISTRY_URL } from "./remote.js";

export interface InstallOptions {
  /** Project root where files land. Every target resolves relative to this. */
  destDir: string;
  /** Base URL of the registry. Defaults to the official public registry. */
  baseUrl?: string;
}

export interface InstallResult {
  /** Absolute paths of files actually written. */
  written: string[];
}

/**
 * Reject target paths that would escape `destDir`. Mirrors the pattern check
 * in `packages/core/schemas/registry-item.json#files.items.target`, but runs at
 * install time so a registry that bypasses schema validation still can't write
 * outside the project.
 */
export function assertSafeTarget(destDir: string, target: string): void {
  if (isAbsolute(target)) {
    throw new Error(`Unsafe target "${target}": absolute paths are not allowed.`);
  }
  if (/(^|[/\\])\.\.([/\\]|$)/.test(target)) {
    throw new Error(`Unsafe target "${target}": path segments may not contain "..".`);
  }
  if (/^[A-Za-z]:[/\\]/.test(target)) {
    throw new Error(`Unsafe target "${target}": Windows drive letters are not allowed.`);
  }
  const resolved = resolve(destDir, target);
  const rel = relative(resolve(destDir), resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Unsafe target "${target}": resolves outside destDir ${destDir}.`);
  }
}

function isInstalledRegistryBlockComposition(item: RegistryItem, file: FileTarget): boolean {
  return (
    item.type === "hyperframes:block" &&
    file.type === "hyperframes:composition" &&
    file.target.toLowerCase().endsWith(".html")
  );
}

function addRegistryItemMarker(source: string, item: RegistryItem): string {
  if (/^\s*<!--\s*hyperframes-registry-item:[^>]*-->/i.test(source.slice(0, 512))) {
    return source;
  }

  return `<!-- hyperframes-registry-item: ${item.name} -->\n${source}`;
}

/**
 * Install a resolved `RegistryItem` into `destDir` by fetching each file in
 * parallel and writing it to its validated target path.
 */
export async function installItem(
  item: RegistryItem,
  options: InstallOptions,
): Promise<InstallResult> {
  const baseUrl = options.baseUrl ?? DEFAULT_REGISTRY_URL;
  const destDir = resolve(options.destDir);

  // Validate all targets up-front so a malformed item fails before any write.
  for (const file of item.files) {
    assertSafeTarget(destDir, file.target);
  }

  const written = await Promise.all(
    item.files.map(async (file: FileTarget) => {
      const destPath = resolve(destDir, file.target);
      await fetchItemFile(item, file, destPath, baseUrl);
      if (isInstalledRegistryBlockComposition(item, file)) {
        const source = readFileSync(destPath, "utf-8");
        writeFileSync(destPath, addRegistryItemMarker(source, item), "utf-8");
      }
      return destPath;
    }),
  );

  return { written };
}
