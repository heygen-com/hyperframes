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

function loadBlocks(): Array<{ name: string; itemDir: string; manifest: RegistryManifest }> {
  return readdirSync(blocksDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const itemDir = join(blocksDir, entry.name);
      return { name: entry.name, itemDir, manifest: loadRegistryManifest(itemDir) };
    });
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
  it("ships a safe editing contract and declared variables for every promoted template", () => {
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
      const editingContract = readFileSync(join(itemDir, "TEMPLATE.md"), "utf8");
      expect(editingContract, templateId).toContain("## Safe editing mechanics");
      expect(editingContract, templateId).toContain("set_template_variable_defaults");
      expect(editingContract, templateId).toContain("HTML-entity-encoded JSON");
      const html = readFileSync(join(itemDir, composition?.path ?? ""), "utf8");
      const { document } = parseHTML(html);
      const declarations = JSON.parse(
        document.documentElement.getAttribute("data-composition-variables") ?? "[]",
      ) as Array<{ id?: unknown; type?: unknown }>;
      expect(declarations.length, templateId).toBeGreaterThan(0);
      expect(document.querySelectorAll("video"), `${templateId}: fixed video media`).toHaveLength(
        0,
      );

      const imageVariableIds = declarations
        .filter(
          (variable): variable is { id: string; type: "image" } =>
            variable.type === "image" && typeof variable.id === "string",
        )
        .map((variable) => variable.id);
      for (const variableId of imageVariableIds) {
        const escapedId = variableId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const occurrenceCount = html.match(new RegExp(`\\b${escapedId}\\b`, "g"))?.length ?? 0;
        expect(
          document.querySelector(`[data-var-src="${variableId}"]`) !== null || occurrenceCount > 1,
          `${templateId}: unbound image variable ${variableId}`,
        ).toBe(true);
      }
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

  // Blocks installing the same shared library overwrite each other's copy, so a stale one downgrades the rest.
  it("ships the same bytes from every block that installs a shared library", () => {
    // target -> bytes -> blocks installing those bytes there
    const installs = new Map<string, Map<string, string[]>>();
    for (const { name, itemDir, manifest } of loadBlocks()) {
      for (const file of manifest.files) {
        if (!file.target.startsWith("compositions/lib/")) continue;
        const content = readFileSync(join(itemDir, file.path), "latin1");
        const byContent = installs.get(file.target) ?? new Map<string, string[]>();
        byContent.set(content, [...(byContent.get(content) ?? []), name]);
        installs.set(file.target, byContent);
      }
    }

    expect(installs.has("compositions/lib/shaders.iife.js")).toBe(true);
    const diverged = [...installs]
      .filter(([, byContent]) => byContent.size > 1)
      .map(([target, byContent]) => `${target}: ${[...byContent.values()].join(" vs ")}`);
    expect(diverged).toEqual([]);
  });

  it("names a shader the shared bundle holds in every shader block", () => {
    const missing: string[] = [];
    for (const { name, itemDir, manifest } of loadBlocks()) {
      const bundle = manifest.files.find((f) => f.target === "compositions/lib/shaders.iife.js");
      const composition = manifest.files.find((f) => f.type === "hyperframes:composition");
      if (!bundle || !composition) continue;
      const html = readFileSync(join(itemDir, composition.path), "utf8");
      const shader = html.match(/data-shader="([^"]+)"/)?.[1];
      const code = readFileSync(join(itemDir, bundle.path), "utf8");
      if (!shader || !code.includes(`name:"${shader}",role:`)) missing.push(`${name}: ${shader}`);
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
