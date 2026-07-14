import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const blocksDir = fileURLToPath(new URL("../../../../registry/blocks", import.meta.url));

describe("registry block manifests", () => {
  it("installs every local script referenced by a block composition", () => {
    const missing: string[] = [];

    for (const entry of readdirSync(blocksDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;

      const itemDir = join(blocksDir, entry.name);
      const manifest = JSON.parse(readFileSync(join(itemDir, "registry-item.json"), "utf8")) as {
        files: Array<{ path: string; type: string }>;
      };
      const manifestPaths = new Set(manifest.files.map((file) => file.path));

      for (const file of manifest.files) {
        if (file.type !== "hyperframes:composition" || !file.path.endsWith(".html")) continue;

        const html = readFileSync(join(itemDir, file.path), "utf8");
        const localScripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)]
          .map((match) => match[1] ?? "")
          .filter((src) => src && !/^(?:[a-z]+:)?\/\//i.test(src));

        for (const src of localScripts) {
          if (!manifestPaths.has(src)) missing.push(`${entry.name}: ${src}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });
});
