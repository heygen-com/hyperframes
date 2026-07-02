// @vitest-environment node
import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runComponentImport } from "./component.js";
import { appendBinding, type FigmaClient } from "@hyperframes/core/figma";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hf-figma-component-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const TREE = {
  id: "1:1",
  name: "Hero Card",
  type: "FRAME",
  absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 },
  fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
  children: [
    {
      id: "1:2",
      name: "Badge",
      type: "RECTANGLE",
      absoluteBoundingBox: { x: 20, y: 20, width: 100, height: 40 },
      fills: [{ type: "SOLID", color: { r: 0, g: 0.4, b: 1, a: 1 } }],
      boundVariables: { fills: [{ type: "VARIABLE_ALIAS", id: "VariableID:1:1" }] },
    },
    {
      id: "1:3",
      name: "Mark",
      type: "VECTOR",
      absoluteBoundingBox: { x: 40, y: 100, width: 64, height: 64 },
    },
  ],
};

const SVG = new TextEncoder().encode("<svg/>");

function client(): FigmaClient {
  return {
    renderNode: () => Promise.resolve({ url: "https://cdn/x", ext: "svg" }),
    imageFills: () => Promise.resolve(new Map()),
    variables: () => Promise.resolve({ variables: {}, variableCollections: {} }),
    styles: () => Promise.resolve([]),
    nodeTree: () => Promise.resolve(TREE),
    fileVersion: () => Promise.resolve({ version: "7", lastModified: "2026-07-01" }),
  };
}

async function importHero() {
  const out = await runComponentImport("FILE:1-1", {
    projectDir: dir,
    client: client(),
    download: () => Promise.resolve(SVG),
  });
  return { out, html: readFileSync(join(dir, out.htmlPath), "utf8") };
}

describe("runComponentImport", () => {
  it("writes component html with resolved var() when the binding index knows the id", async () => {
    appendBinding(dir, {
      kind: "binding",
      figmaId: "VariableID:1:1",
      sourceFileKey: "FILE",
      compositionVariableId: "figma:Blue/500",
      version: "7",
    });
    const { out, html } = await importHero();
    expect(html).toContain("var(--figma-blue-500, #0066FF)");
    expect(out.unresolved).toEqual([]);
  });

  it("bakes literals and reports unresolved bindings when the index is empty", async () => {
    const { out, html } = await importHero();
    expect(html).toContain("background: #0066FF");
    expect(html).not.toContain("var(");
    expect(out.unresolved).toHaveLength(1);
    expect(out.unresolved[0]?.figmaId).toBe("VariableID:1:1");
  });

  it("rasterizes vectors into frozen assets, fills img src, writes the registry item", async () => {
    const { out, html } = await importHero();
    expect(html).toContain('src="../../../.media/images/image_001.svg"');
    expect(out.rasterized).toHaveLength(1);
    const item = JSON.parse(
      readFileSync(
        join(dir, "compositions", "components", "hero-card", "registry-item.json"),
        "utf8",
      ),
    ) as { type: string; files: Array<{ type: string }> };
    expect(item.type).toBe("hyperframes:component");
    expect(item.files.some((f) => f.type === "hyperframes:snippet")).toBe(true);
    expect(out.name).toBe("hero-card");
  });
});
