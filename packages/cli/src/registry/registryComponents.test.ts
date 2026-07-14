import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { lintHyperframeHtml } from "@hyperframes/lint";
import { describe, expect, it } from "vitest";

const componentsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../registry/components",
);

interface RegistryManifest {
  files: Array<{ path: string; type: string }>;
}

describe("registry components", () => {
  it("ships installable snippets without invalid nested media", async () => {
    const invalidMedia: string[] = [];

    for (const entry of readdirSync(componentsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;

      const itemDir = join(componentsDir, entry.name);
      const manifest = JSON.parse(
        readFileSync(join(itemDir, "registry-item.json"), "utf8"),
      ) as RegistryManifest;

      for (const file of manifest.files) {
        if (file.type !== "hyperframes:snippet" || !file.path.endsWith(".html")) continue;
        const result = await lintHyperframeHtml(readFileSync(join(itemDir, file.path), "utf8"));
        for (const finding of result.findings) {
          if (finding.code !== "media_in_subcomposition" && finding.code !== "media_missing_src") {
            continue;
          }
          invalidMedia.push(`${entry.name}/${file.path}: ${finding.code}`);
        }
      }
    }

    expect(invalidMedia).toEqual([]);
  });
});
