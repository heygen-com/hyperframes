import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { withRootImportMap } from "./rootImportMap.js";

const BASE = "/api/projects/demo/preview/";
const maps = (html: string) =>
  [...html.matchAll(/<script type="importmap">([^<]*)<\/script>/g)].map((match) =>
    JSON.parse(match[1] ?? ""),
  );

describe("withRootImportMap", () => {
  it("adds one map: root module paths go under the base, and the base keeps its own", () => {
    const html = withRootImportMap("<!doctype html><html><head></head><body></body></html>", BASE);
    expect(maps(html)).toEqual([{ imports: { "/": BASE, [BASE]: BASE } }]);
  });

  it("puts its entries in the composition's own map, moving that map's root-path targets under the base", () => {
    const own = JSON.stringify({
      imports: { three: "/vendor/three.module.js", cdn: "https://cdn.example/x.js", "/": "/lib/" },
      scopes: { "/vendor/": { util: "/vendor/util.js" } },
    });
    const html = withRootImportMap(
      `<!doctype html><html><head><script type="importmap">${own}</script><script type="module">import "three";</script></head></html>`,
      BASE,
    );
    expect(maps(html)).toEqual([
      {
        imports: {
          "/": `${BASE}lib/`,
          [BASE]: BASE,
          three: `${BASE}vendor/three.module.js`,
          cdn: "https://cdn.example/x.js",
        },
        scopes: { [`${BASE}vendor/`]: { util: `${BASE}vendor/util.js` } },
      },
    ]);
    expect(html.indexOf("importmap")).toBeLessThan(html.indexOf('type="module"'));
  });

  it("leaves a map the browser would refuse, and adds its own beside a template's", () => {
    const broken = `<html><head><script type="importmap">{not json</script></head></html>`;
    expect(withRootImportMap(broken, BASE)).toBe(broken);
    const inTemplate = withRootImportMap(
      `<html><head></head><body><template><script type="importmap">{"imports":{}}</script></template></body></html>`,
      BASE,
    );
    expect(maps(inTemplate)).toEqual([{ imports: { "/": BASE, [BASE]: BASE } }, { imports: {} }]);
  });

  it("has no dynamic import in the preview runtime, which the map would send under the project", () => {
    const runtime = resolve(import.meta.dirname, "../../../core/src/runtime");
    const sources = readdirSync(runtime, { recursive: true, encoding: "utf8" }).filter(
      (file) => file.endsWith(".ts") && !file.endsWith(".test.ts"),
    );
    expect(sources.length).toBeGreaterThan(20);
    const importing = sources.filter((file) =>
      /(?<!typeof )\bimport\s*\(/.test(readFileSync(join(runtime, file), "utf8")),
    );
    expect(importing).toEqual([]);
  });
});
