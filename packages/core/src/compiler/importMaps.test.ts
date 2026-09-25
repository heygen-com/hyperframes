import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mergeImportMapsIntoDocument, parseImportMap } from "./importMaps";

afterEach(() => vi.restoreAllMocks());

const pageWith = (head: string) =>
  parseHTML(`<!doctype html><html><head>${head}</head><body></body></html>`).document;
const mapOf = (doc: Document) =>
  JSON.parse(doc.querySelector('script[type="importmap"]')?.textContent || "null");

describe("parseImportMap", () => {
  it("rebases imports and scopes, and rejects what the browser would reject", () => {
    const rebase = (url: string) => `R(${url})`;
    expect(
      parseImportMap(`{"imports":{"a":"./a.js"},"scopes":{"./s/":{"b":"./b.js"}}}`, rebase),
    ).toEqual({ imports: { a: "R(./a.js)" }, scopes: { "R(./s/)": { b: "R(./b.js)" } } });
    expect(parseImportMap("{ not json", rebase)).toBeNull();
    expect(parseImportMap("null", rebase)).toBeNull();
  });
});

describe("mergeImportMapsIntoDocument", () => {
  it("creates the page's one import map ahead of every script when it has none", () => {
    const doc = pageWith(`<script type="module" src="x.js"></script>`);
    mergeImportMapsIntoDocument(doc, [{ imports: { three: "./t.js" } }]);
    expect(doc.head.firstElementChild?.getAttribute("type")).toBe("importmap");
    expect(mapOf(doc)).toEqual({ imports: { three: "./t.js" } });
  });

  it("keeps the first mapping of a specifier and warns about a conflicting one", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const doc = pageWith(
      `<script type="importmap">{"imports":{"three":"./page.js"},"integrity":{"./page.js":"sha384-x"}}</script>`,
    );
    mergeImportMapsIntoDocument(doc, [
      { imports: { three: "./mounted.js", gsap: "./g.js" }, scopes: { "./s/": { a: "./a.js" } } },
      { imports: { gsap: "./g.js" }, scopes: { "./s/": { a: "./other.js" } } },
    ]);
    expect(doc.querySelectorAll('script[type="importmap"]')).toHaveLength(1);
    expect(mapOf(doc)).toEqual({
      imports: { three: "./page.js", gsap: "./g.js" },
      scopes: { "./s/": { a: "./a.js" } },
      integrity: { "./page.js": "sha384-x" },
    });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0]?.[0])).toContain('"three"');
  });

  it("leaves the page alone when no mounted file declares a map", () => {
    const doc = pageWith("");
    mergeImportMapsIntoDocument(doc, []);
    expect(doc.querySelector('script[type="importmap"]')).toBeNull();
  });
});
