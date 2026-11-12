import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const src = import.meta.dirname;

/** Every file `entry` reaches through static imports and re-exports, with any package it names. */
function importGraph(entry: string): { files: string[]; packages: string[] } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    for (const { fileName } of ts.preProcessFile(readFileSync(file, "utf8")).importedFiles) {
      if (!fileName.startsWith(".")) {
        packages.add(fileName);
        continue;
      }
      const base = resolve(dirname(file), fileName);
      visit(
        [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find((f) => ts.sys.fileExists(f))!,
      );
    }
  };
  visit(join(src, entry));
  return {
    files: [...files].map((f) => relative(src, f).split(sep).join("/")).sort(),
    packages: [...packages],
  };
}

describe("@hyperframes/studio/keys", () => {
  it("imports only the key helpers: no package and no editor module", () => {
    expect(importGraph("keys.ts")).toEqual({
      files: [
        "keys.ts",
        "player/components/studioCombo.ts",
        "player/components/studioKeyDefaults.ts",
      ],
      packages: [],
    });
  });

  it("is a published subpath sharing the defaults the root entry exports", async () => {
    const pkg = JSON.parse(readFileSync(join(src, "../package.json"), "utf8"));
    expect(pkg.exports["./keys"].import).toBe("./src/keys.ts");
    expect(pkg.publishConfig.exports["./keys"].import).toBe("./dist/keys.js");
    const keys = await import("./keys");
    const shortcuts = await import("./player/components/studioShortcuts");
    expect(keys.DEFAULT_STUDIO_KEYS).toBe(shortcuts.DEFAULT_STUDIO_KEYS);
  });
});
