import { createRequire } from "node:module";
import postcss from "postcss";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCss } from "./postcss";

const PreviousMap = createRequire(import.meta.url)("postcss/lib/previous-map") as {
  prototype: { loadAnnotation(css: string): void };
};

const inlineMap = Buffer.from(
  JSON.stringify({ version: 3, sources: ["a.scss"], names: [], mappings: "AAAA" }),
).toString("base64");
const CSS = `.a{color:red}\n/*# sourceMappingURL=data:application/json;base64,${inlineMap} */`;

describe("parseCss", () => {
  afterEach(() => vi.restoreAllMocks());

  it("takes no source map from a comment in the CSS", () => {
    const lookup = vi.spyOn(PreviousMap.prototype, "loadAnnotation");

    const root = parseCss(CSS);

    expect(lookup).not.toHaveBeenCalled();
    expect(root.source?.input.map).toBeUndefined();
    expect(postcss.parse(CSS).source?.input.map).toBeDefined();
  });

  it("parses and prints the CSS as postcss does", () => {
    expect(parseCss(CSS).toString()).toBe(postcss.parse(CSS).toString());
    expect(parseCss(".a{color:red}").first?.toString()).toBe(".a{color:red}");
  });
});
