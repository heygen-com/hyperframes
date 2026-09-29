/**
 * Where a CDN-hosted registry asset is referenced from, and by what name.
 *
 * A `files[]` entry with `url` keeps its `path`: that is still where the file
 * lands when someone runs `hyperframes add`, and an installed project reads it
 * from disk exactly as before. The Catalog is the one consumer that never
 * installs anything — it publishes a payload the browser fetches — so for that
 * one path the local name has to become the CDN URL, or the bytes get copied
 * into `docs/public/` and the repository carries them after all.
 *
 * Both generators that build the Catalog need the same mapping, so it lives
 * here rather than in either of them.
 */

import type { RegistryItem } from "../packages/core/src/index.js";

/**
 * Every local name a composition might use for a hosted file, mapped to its
 * URL.
 *
 * Both `path` and `target` are keys because a composition may reference either:
 * `path` is the name beside the manifest, `target` is where the installer puts
 * it, and `mirrorRegistryTargets` exists precisely because those differ for
 * some items.
 */
export function hostedUrlByReference(manifest: RegistryItem): Map<string, string> {
  const byReference = new Map<string, string>();
  for (const file of manifest.files ?? []) {
    if (file.url === undefined) continue;
    byReference.set(file.path, file.url);
    byReference.set(file.target, file.url);
  }
  return byReference;
}

/**
 * The same variables with any default that names a hosted file swapped for its
 * URL.
 *
 * An image variable's default is the only reference the Catalog can rewrite:
 * these compositions assemble `img.src` at run time from the variable value, so
 * there is no attribute in the markup for an asset scan to find. That is also
 * why they were being published with a copy of their whole directory.
 *
 * Returns new objects. The manifest is read by other callers that still want
 * the local paths, and mutating it in place gave them the CDN URLs too.
 */
export function withHostedDefaults<T extends { default?: unknown }>(
  variables: readonly T[],
  manifest: RegistryItem,
): T[] {
  const byReference = hostedUrlByReference(manifest);
  if (byReference.size === 0) return [...variables];
  return variables.map((variable) => {
    const url =
      typeof variable.default === "string" ? byReference.get(variable.default) : undefined;
    return url === undefined ? variable : { ...variable, default: url };
  });
}

/** Does this file's declared type stay in the repository? */
export function isLocalAsset(file: { type?: string; url?: string }): boolean {
  return file.type === "hyperframes:asset" && file.url === undefined;
}
