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
});
