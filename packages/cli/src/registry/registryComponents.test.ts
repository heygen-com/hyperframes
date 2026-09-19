import { existsSync, readFileSync, readdirSync } from "node:fs";
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

async function invalidInstallableMedia(entryName: string): Promise<string[]> {
  const itemDir = join(componentsDir, entryName);
  const manifest = JSON.parse(
    readFileSync(join(itemDir, "registry-item.json"), "utf8"),
  ) as RegistryManifest;
  const invalidMedia: string[] = [];

  for (const file of manifest.files) {
    if (file.type !== "hyperframes:snippet" || !file.path.endsWith(".html")) continue;
    const result = await lintHyperframeHtml(readFileSync(join(itemDir, file.path), "utf8"), {
      isSubComposition: true,
    });
    for (const finding of result.findings) {
      if (finding.code !== "media_missing_src") continue;
      invalidMedia.push(`${entryName}/${file.path}: ${finding.code}`);
    }
  }

  return invalidMedia;
}

async function invalidDemoMedia(entryName: string): Promise<string[]> {
  const demoPath = join(componentsDir, entryName, "demo.html");
  if (!existsSync(demoPath)) return [];

  const result = await lintHyperframeHtml(readFileSync(demoPath, "utf8"));
  return result.findings
    .filter((finding) => finding.code === "media_missing_src")
    .map((finding) => `${entryName}/demo.html: ${finding.code}`);
}

const entryNames = readdirSync(componentsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

describe("registry components", () => {
  it.each(entryNames)(
    "%s ships installable snippets without invalid nested media",
    async (name) => {
      expect(await invalidInstallableMedia(name)).toEqual([]);
    },
  );

  it.each(entryNames)("%s ships a demo without source-less media", async (name) => {
    expect(await invalidDemoMedia(name)).toEqual([]);
  });
});
