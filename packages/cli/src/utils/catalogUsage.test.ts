import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { summarizeCatalogUsage, type CatalogUsage } from "./catalogUsage.js";
import type { RegistryItemRecord } from "./projectConfig.js";

/**
 * Materialize a throwaway project, summarize it, and clean up. Every case here
 * needs the same fixture, so the shape lives once.
 */
function usageOf(
  files: Record<string, string>,
  registryItems?: RegistryItemRecord[],
  entry = "index.html",
): CatalogUsage {
  const dir = mkdtempSync(join(tmpdir(), "hf-catalog-test-"));
  try {
    writeFileSync(
      join(dir, "hyperframes.json"),
      JSON.stringify({
        registry: "https://example.test",
        ...(registryItems ? { registryItems } : {}),
      }),
    );
    for (const [rel, html] of Object.entries(files)) {
      const path = join(dir, rel);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, html);
    }
    return summarizeCatalogUsage(dir, join(dir, entry));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function mount(src: string): string {
  return `<!doctype html><html><body><div data-composition-src="${src}" data-duration="3"></div></body></html>`;
}

const EMPTY_DOC = "<!doctype html><html></html>";

const BLOCK = (name: string): RegistryItemRecord => ({
  name,
  type: "hyperframes:block",
  target: `compositions/${name}.html`,
});

describe("summarizeCatalogUsage", () => {
  it("reports nothing for a project that never added a catalog item", () => {
    expect(usageOf({ "index.html": EMPTY_DOC })).toEqual({ installed: [], usedBlocks: [] });
  });

  // The whole point of the manifest: an item that was installed and then not
  // mounted is a rejection, and no add-time event can say so.
  it("separates an installed block that the entry mounts from one it dropped", () => {
    expect(
      usageOf(
        {
          "index.html": mount("compositions/kept.html"),
          "compositions/kept.html": EMPTY_DOC,
          "compositions/dropped.html": EMPTY_DOC,
        },
        [BLOCK("kept"), BLOCK("dropped")],
      ),
    ).toEqual({ installed: ["dropped", "kept"], usedBlocks: ["kept"] });
  });

  it("follows nested mounts, so a block reached through another block counts", () => {
    expect(
      usageOf(
        {
          "index.html": mount("compositions/outer.html"),
          "compositions/outer.html": mount("inner.html"),
          "compositions/inner.html": EMPTY_DOC,
        },
        [BLOCK("outer"), BLOCK("inner")],
      ).usedBlocks,
    ).toEqual(["inner", "outer"]);
  });

  // A cyclic project must not wedge a render that already produced a video.
  it("terminates on a mount cycle", () => {
    expect(
      usageOf(
        {
          "index.html": mount("compositions/a.html"),
          "compositions/a.html": mount("b.html"),
          "compositions/b.html": mount("a.html"),
        },
        [BLOCK("a"), BLOCK("b")],
      ).usedBlocks,
    ).toEqual(["a", "b"]);
  });

  // Components are pasted inline, so there is no src to match. Reporting one as
  // "used" would be a guess; reporting it as installed is a fact.
  it("counts a component as installed but never as used", () => {
    expect(
      usageOf({ "index.html": EMPTY_DOC }, [
        {
          name: "film-grain",
          type: "hyperframes:component",
          target: "compositions/components/film-grain.html",
        },
      ]),
    ).toEqual({ installed: ["film-grain"], usedBlocks: [] });
  });

  it("drops a manifest name that is not a safe slug rather than sending it", () => {
    expect(
      usageOf({ "index.html": EMPTY_DOC }, [
        { name: "/Users/someone/secret", type: "hyperframes:block", target: "compositions/x.html" },
        BLOCK("fine"),
      ]).installed,
    ).toEqual(["fine"]);
  });

  it("never matches a manifest target that escapes the project directory", () => {
    expect(
      usageOf({ "index.html": mount("compositions/kept.html") }, [
        { name: "escaping", type: "hyperframes:block", target: "../outside.html" },
      ]).usedBlocks,
    ).toEqual([]);
  });

  it("survives an entry file that does not exist", () => {
    expect(usageOf({}, [BLOCK("kept")], "missing.html")).toEqual({
      installed: ["kept"],
      usedBlocks: [],
    });
  });

  it("ignores a remote mount rather than resolving it as a local path", () => {
    expect(
      usageOf({ "index.html": mount("https://example.test/compositions/kept.html") }, [
        BLOCK("kept"),
      ]).usedBlocks,
    ).toEqual([]);
  });
});
