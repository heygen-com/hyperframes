import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const blocksDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../registry/blocks");
const componentsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../registry/components",
);

interface RegistryManifest {
  files: Array<{ path: string; type: string }>;
}

function findMissingLocalScripts(itemDir: string, manifest: RegistryManifest): string[] {
  const manifestPaths = new Set(manifest.files.map((file) => file.path));
  const missing: string[] = [];

  for (const file of manifest.files) {
    if (file.type !== "hyperframes:composition" || !file.path.endsWith(".html")) continue;

    const html = readFileSync(join(itemDir, file.path), "utf8");
    const localScripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)]
      .map((match) => match[1] ?? "")
      .filter((src) => src && !/^(?:[a-z]+:)?\/\//i.test(src));

    for (const src of localScripts) {
      if (!manifestPaths.has(src)) missing.push(src);
    }
  }

  return missing;
}

describe("registry block manifests", () => {
  it("installs every local script referenced by a block composition", () => {
    const missing: string[] = [];

    for (const entry of readdirSync(blocksDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;

      const itemDir = join(blocksDir, entry.name);
      const manifest = JSON.parse(
        readFileSync(join(itemDir, "registry-item.json"), "utf8"),
      ) as RegistryManifest;

      for (const src of findMissingLocalScripts(itemDir, manifest)) {
        missing.push(`${entry.name}: ${src}`);
      }
    }

    expect(missing).toEqual([]);
  });
});

describe("caption component manifests", () => {
  it("ships caption overlays without placeholder media elements", () => {
    const mediaElements: string[] = [];

    for (const entry of readdirSync(componentsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith("caption-")) continue;

      const itemDir = join(componentsDir, entry.name);
      const manifest = JSON.parse(
        readFileSync(join(itemDir, "registry-item.json"), "utf8"),
      ) as RegistryManifest;
      for (const file of manifest.files) {
        if (!file.path.endsWith(".html")) continue;
        const html = readFileSync(join(itemDir, file.path), "utf8").replace(/<!--[\s\S]*?-->/g, "");
        if (/<(?:video|audio)\b/i.test(html)) mediaElements.push(`${entry.name}: ${file.path}`);
      }
    }

    expect(mediaElements).toEqual([]);
  });
});
