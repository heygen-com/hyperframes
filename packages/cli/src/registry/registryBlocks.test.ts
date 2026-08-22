import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleToSingleHtml } from "@hyperframes/core/compiler";
import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";

const blocksDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../registry/blocks");

interface RegistryManifest {
  name: string;
  tags?: string[];
  files: Array<{ path: string; target: string; type: string }>;
}

const promotedTemplateTag = "ad-template";

function loadRegistryManifest(itemDir: string): RegistryManifest {
  return JSON.parse(readFileSync(join(itemDir, "registry-item.json"), "utf8")) as RegistryManifest;
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

describe("registry blocks", () => {
  it("ships an editing contract and declared variables for every promoted template", () => {
    const promotedManifests = readdirSync(blocksDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        itemDir: join(blocksDir, entry.name),
        manifest: loadRegistryManifest(join(blocksDir, entry.name)),
      }))
      .filter(({ manifest }) => manifest.tags?.includes(promotedTemplateTag));

    expect(promotedManifests.length).toBeGreaterThan(0);
    for (const { itemDir, manifest } of promotedManifests) {
      const templateId = manifest.name;
      const contractFiles = manifest.files.filter(
        (file) =>
          file.path === "TEMPLATE.md" &&
          file.target === "TEMPLATE.md" &&
          file.type === "hyperframes:asset",
      );
      const composition = manifest.files.find((file) => file.type === "hyperframes:composition");

      expect(contractFiles, templateId).toHaveLength(1);
      expect(composition, templateId).toBeDefined();
      const html = readFileSync(join(itemDir, composition?.path ?? ""), "utf8");
      const { document } = parseHTML(html);
      const declarations = JSON.parse(
        document.documentElement.getAttribute("data-composition-variables") ?? "[]",
      ) as unknown[];
      expect(declarations.length, templateId).toBeGreaterThan(0);
    }
  });

  it("installs every local script referenced by a block composition", () => {
    const missing: string[] = [];

    for (const entry of readdirSync(blocksDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;

      const itemDir = join(blocksDir, entry.name);
      const manifest = loadRegistryManifest(itemDir);

      for (const src of findMissingLocalScripts(itemDir, manifest)) {
        missing.push(`${entry.name}: ${src}`);
      }
    }

    expect(missing).toEqual([]);
  });

  it("keeps the Camcorder HUD seekable inside a differently named host composition", async () => {
    const bundled = await bundleToSingleHtml(resolve(blocksDir, "camcorder-hud"), {
      entryFile: "demo.html",
    });
    const { document } = parseHTML(bundled);
    const demo = document.getElementById("camcorder-hud-demo");
    const hud = document.getElementById("ch-demo-overlay");

    expect(demo?.getAttribute("data-composition-id")).toBe("camcorder-hud-demo");
    expect(hud?.getAttribute("data-composition-id")).toBe("camcorder-hud");
    expect(hud?.hasAttribute("data-composition-src")).toBe(false);
    expect(bundled).toContain('var __hfTimelineCompId = "camcorder-hud";');
  });
});
