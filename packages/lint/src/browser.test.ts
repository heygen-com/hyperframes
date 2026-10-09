import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { lintHyperframeHtml, shouldBlockRender } from "./browser.js";

// Guards that @hyperframes/lint/browser exposes a working, node-free rule engine.
// (The platform:"browser" tsup build is the compile-time node-free guarantee;
// this verifies the API actually runs.)
const IMPORT_SPECIFIER =
  /^(?:import|export)\s[^"';]*?\bfrom\s+["']([^"']+)["']|^import\s+["']([^"']+)["']/gm;

const resolveSource = (path: string): string => {
  const base = path.replace(/\.js$/, "");
  return [`${base}.ts`, `${base}/index.ts`].find((candidate) => existsSync(candidate)) ?? path;
};

describe("@hyperframes/lint/browser", () => {
  it("lints an HTML string with no filesystem access", async () => {
    const html = `<html><body>
      <div data-composition-id="main" data-width="1920" data-height="1080"></div>
    </body></html>`;
    const result = await lintHyperframeHtml(html, { filePath: "index.html" });
    expect(typeof result.ok).toBe("boolean");
    expect(Array.isArray(result.findings)).toBe(true);
  });

  it("reaches no node: module, including through @hyperframes/parsers", () => {
    const parsersDir = resolve(fileURLToPath(import.meta.url), "../../../parsers");
    const parsersExports = JSON.parse(readFileSync(`${parsersDir}/package.json`, "utf8")).exports;
    const seen = new Set<string>();
    const nodeImports: string[] = [];
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = readFileSync(file, "utf8");
      for (const [, from, bare] of source.matchAll(IMPORT_SPECIFIER)) {
        const spec = from ?? bare ?? "";
        if (spec.startsWith("node:")) nodeImports.push(`${file}: ${spec}`);
        else if (spec.startsWith(".")) visit(resolveSource(resolve(dirname(file), spec)));
        else if (spec.startsWith("@hyperframes/parsers"))
          visit(resolve(parsersDir, parsersExports[spec.replace("@hyperframes/parsers", ".")].bun));
      }
    };
    visit(resolve(fileURLToPath(import.meta.url), "../browser.ts"));
    expect(seen.size).toBeGreaterThan(10);
    expect(nodeImports).toEqual([]);
  });

  it("exposes the pure shouldBlockRender gate", () => {
    expect(shouldBlockRender(true, false, 1, 0)).toBe(true);
    expect(shouldBlockRender(true, false, 0, 3)).toBe(false);
    expect(shouldBlockRender(false, true, 0, 1)).toBe(true);
  });
});
