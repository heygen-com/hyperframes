// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSync } from "esbuild";
import { describe, expect, it } from "vitest";

const packageDir = resolve(import.meta.dirname, "..");
const { subpaths } = JSON.parse(readFileSync(resolve(packageDir, "package-subpaths.json"), "utf8"));
const HEAVY = /[\\/](recast|ast-types|@babel[\\/]parser|acorn|esprima|linkedom|postcss)[\\/]/;

function loadedModules(entry: string): string[] {
  const { metafile } = buildSync({
    entryPoints: [resolve(packageDir, subpaths[entry].source)],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    metafile: true,
    logLevel: "silent",
  });
  return Object.keys(metafile.inputs);
}

describe("entries a host imports for one helper", () => {
  it.each(["./safe-path", "./asset-paths"])("%s loads none of the parsers", (entry) => {
    expect(loadedModules(entry).filter((path) => HEAVY.test(path))).toEqual([]);
  });
});
