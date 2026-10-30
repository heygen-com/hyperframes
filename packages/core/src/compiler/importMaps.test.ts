import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mergeImportMapsIntoDocument, parseImportMap } from "./importMaps";

afterEach(() => vi.restoreAllMocks());

const pageWith = (head: string) =>
  parseHTML(`<!doctype html><html><head>${head}</head><body></body></html>`).document;
const mapOf = (doc: Document) =>
  JSON.parse(doc.querySelector('script[type="importmap"]')?.textContent || "null");

describe("parseImportMap", () => {
  it.each([null, 17, false, [], {}].map((address) => ({ address })))(
    "keeps $address addresses blocked without rebasing them",
    ({ address }) => {
      const rebase = vi.fn((url: string) => `R(${url})`);
      const result = parseImportMap(
        JSON.stringify({
          imports: { ok: "./ok.js", blocked: address },
          scopes: { "./s/": { ok: "./scoped.js", blocked: address } },
        }),
        rebase,
      );
      expect(result).toEqual({
        imports: { ok: "R(./ok.js)", blocked: null },
        scopes: { "R(./s/)": { ok: "R(./scoped.js)", blocked: null } },
      });
      expect(rebase.mock.calls.map(([url]) => url).sort()).toEqual([
        "./ok.js",
        "./s/",
        "./scoped.js",
      ]);
    },
  );

  it.each([
    "[]",
    '{"imports":null}',
    '{"imports":[]}',
    '{"imports":17}',
    '{"scopes":null}',
    '{"scopes":[]}',
    '{"scopes":17}',
  ])("rejects an invalid import-map structure: %s", (json) => {
    expect(parseImportMap(json, (url) => url)).toBeNull();
  });

  it.each([null, 17, false, []].map((scope) => ({ scope })))(
    "rejects a non-object scope: $scope",
    ({ scope }) => {
      expect(
        parseImportMap(
          JSON.stringify({
            imports: { ok: "./ok.js" },
            scopes: { "./s/": scope },
          }),
          (url) => url,
        ),
      ).toBeNull();
    },
  );

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

  it("merges object-property names as ordinary specifiers", () => {
    const doc = pageWith("");
    const imports = Object.fromEntries([
      ["constructor", "./ctor.js"],
      ["toString", "./string.js"],
      ["__proto__", "./proto.js"],
    ]);
    mergeImportMapsIntoDocument(doc, [{ imports }]);
    expect(mapOf(doc)).toEqual({ imports });
  });

  it.each(["__proto__", "constructor"])(
    "keeps the %s scope without writing its entries onto global objects",
    (prefix) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const globalObject = prefix === "constructor" ? Object : Object.prototype;
      const specifier = "__hfScopedOnly";
      const original = Object.getOwnPropertyDescriptor(globalObject, specifier);
      const doc = pageWith("");
      const map = (address: string | null) => {
        const parsed = parseImportMap(
          JSON.stringify({ scopes: Object.fromEntries([[prefix, { [specifier]: address }]]) }),
          (url) => url,
        );
        if (!parsed) throw new Error("Expected a valid import map");
        return parsed;
      };
      try {
        mergeImportMapsIntoDocument(doc, [map(null), map("./later.js")]);
        expect(Object.getOwnPropertyDescriptor(globalObject, specifier)).toEqual(original);
        expect(mapOf(doc)).toEqual({
          imports: {},
          scopes: Object.fromEntries([[prefix, { [specifier]: null }]]),
        });
        expect(warn).toHaveBeenCalledTimes(1);
      } finally {
        if (original) Object.defineProperty(globalObject, specifier, original);
        else Reflect.deleteProperty(globalObject, specifier);
      }
    },
  );

  it("keeps blocked entries when later maps provide an address", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const doc = pageWith(
      '<script type="importmap">{"imports":{"blocked":null},"scopes":{"./s/":{"blocked":null}}}</script>',
    );
    const map = parseImportMap(
      '{"imports":{"blocked":"./ok.js"},"scopes":{"./s/":{"blocked":"./ok.js"}}}',
      (url) => url,
    );
    if (!map) throw new Error("Expected a valid import map");
    mergeImportMapsIntoDocument(doc, [map]);
    expect(mapOf(doc)).toEqual({
      imports: { blocked: null },
      scopes: { "./s/": { blocked: null } },
    });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("leaves the page alone when no mounted file declares a map", () => {
    const doc = pageWith("");
    mergeImportMapsIntoDocument(doc, []);
    expect(doc.querySelector('script[type="importmap"]')).toBeNull();
  });
});
