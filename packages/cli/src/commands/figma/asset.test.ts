// @vitest-environment node
import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAssetImport, type AssetImportDeps } from "./asset.js";
import type { FigmaClient } from "@hyperframes/core/figma";

const dirs: string[] = [];
function scratch(): string {
  const d = mkdtempSync(join(tmpdir(), "hf-figma-asset-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function fakeClient(overrides: Partial<FigmaClient> = {}): FigmaClient {
  return {
    renderNode: () => Promise.resolve({ url: "https://cdn.example/a", ext: "png" }),
    imageFills: () => Promise.resolve(new Map()),
    variables: () => Promise.resolve({ variables: {}, variableCollections: {} }),
    styles: () => Promise.resolve([]),
    nodeTree: () => Promise.resolve({ id: "1:2", name: "n", type: "FRAME" }),
    fileVersion: () => Promise.resolve({ version: "7", lastModified: "2026-07-01" }),
    ...overrides,
  };
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function deps(projectDir: string, overrides: Partial<AssetImportDeps> = {}): AssetImportDeps {
  return {
    projectDir,
    client: fakeClient(),
    download: () => Promise.resolve(PNG_BYTES),
    ...overrides,
  };
}

describe("runAssetImport", () => {
  it("freezes the render, appends a manifest record with provenance, returns a snippet", async () => {
    const dir = scratch();
    const out = await runAssetImport(
      "https://www.figma.com/design/FILEKEY/T?node-id=1-2",
      { format: "png" },
      deps(dir),
    );
    expect(out.record.provenance).toMatchObject({
      source: "figma",
      fileKey: "FILEKEY",
      nodeId: "1:2",
      version: "7",
      format: "png",
    });
    expect(out.snippet.html).toContain("<img");
    const frozen = readFileSync(join(dir, out.record.path));
    expect(Array.from(frozen)).toEqual(Array.from(PNG_BYTES));
    const manifest = readFileSync(join(dir, ".media", "manifest.jsonl"), "utf8");
    expect(manifest).toContain('"fileKey":"FILEKEY"');
  });

  it("sanitizes svg output before freezing", async () => {
    const dir = scratch();
    const dirty = `<svg><script>evil()</script><rect width="1"/></svg>`;
    const out = await runAssetImport(
      "FILEKEY:1-2",
      { format: "svg" },
      deps(dir, {
        client: fakeClient({
          renderNode: () => Promise.resolve({ url: "https://cdn.example/a", ext: "svg" }),
        }),
        download: () => Promise.resolve(new TextEncoder().encode(dirty)),
      }),
    );
    const frozen = readFileSync(join(dir, out.record.path), "utf8");
    expect(frozen).not.toContain("script");
    expect(frozen).toContain("<rect");
  });

  it("reuses on identical version, re-imports when the file version moved on", async () => {
    const dir = scratch();
    const importPng = (over?: Partial<AssetImportDeps>) =>
      runAssetImport("FILEKEY:1-2", { format: "png" }, deps(dir, over));
    const first = await importPng();
    const sameVersion = await importPng();
    expect(sameVersion.record.id).toBe(first.record.id);
    expect(sameVersion.reused).toBe(true);
    const bumped = await importPng({
      client: fakeClient({
        fileVersion: () => Promise.resolve({ version: "8", lastModified: "2026-07-02" }),
      }),
    });
    expect(bumped.reused).toBe(false);
    expect(bumped.record.id).not.toBe(first.record.id);
  });

  it("rejects a ref without a node id", async () => {
    await expect(runAssetImport("FILEKEYONLY", { format: "png" }, deps(scratch()))).rejects.toThrow(
      /node/i,
    );
  });

  it("records description + entity and regenerates .media/index.md", async () => {
    const dir = scratch();
    const out = await runAssetImport(
      "KEY:1-2",
      { format: "png", description: "hero illustration", entity: "Acme hero" },
      deps(dir),
    );
    expect(out.record.description).toBe("hero illustration");
    expect(out.record.entity).toBe("Acme hero");
    expect(out.snippet.html).toContain('alt="hero illustration"');
    const index = readFileSync(join(dir, ".media", "index.md"), "utf8");
    expect(index).toContain("hero illustration");
    expect(index).toContain(out.record.id);
  });

  it("applies --description/--entity on a reuse hit instead of dropping them", async () => {
    const dir = scratch();
    const first = await runAssetImport("KEY:1-2", { format: "png" }, deps(dir));
    expect(first.record.description).toBeUndefined();
    const again = await runAssetImport(
      "KEY:1-2",
      { format: "png", description: "Acme logo", entity: "Acme logo" },
      deps(dir),
    );
    expect(again.reused).toBe(true);
    expect(again.record.description).toBe("Acme logo");
    expect(again.snippet.html).toContain('alt="Acme logo"');
    const index = readFileSync(join(dir, ".media", "index.md"), "utf8");
    expect(index).toContain("Acme logo");
    expect(index).not.toContain("image_002");
  });

  it("reuses against ANY matching tuple, not just the oldest row", async () => {
    const dir = scratch();
    await runAssetImport("KEY:1-2", { format: "svg" }, deps(dir)); // image_001 (svg)
    const png = await runAssetImport("KEY:1-2", { format: "png" }, deps(dir)); // image_002
    expect(png.reused).toBe(false);
    const pngAgain = await runAssetImport("KEY:1-2", { format: "png" }, deps(dir));
    expect(pngAgain.reused).toBe(true);
    expect(pngAgain.record.id).toBe(png.record.id);
  });

  it("flattens whitespace in descriptions so index.md rows stay single-line", async () => {
    const dir = scratch();
    const out = await runAssetImport(
      "KEY:1-2",
      { format: "png", description: "line one\nline two" },
      deps(dir),
    );
    expect(out.record.description).toBe("line one line two");
  });
});
