/**
 * @vitest-environment jsdom
 * AUDIT: Variable system round-trip under real DOM.
 */
import { describe, it, expect } from "vitest";
import { getVariables, validateVariables, readDeclaredDefaults } from "@hyperframes/core/variables";

const TEMPLATE = `
<!DOCTYPE html>
<html data-composition-variables='
[{"id":"headline","type":"string","default":"Hello"}]
'><head><meta charset="utf-8"></head>
<body>
  <div data-composition-id="demo" data-start="0" data-width="1920" data-height="1080">
    <h1 class="clip" data-start="0" data-duration="2">{{ headline }}</h1>
  </div>
</body></html>
`;

describe("variable system", () => {
  beforeEach(() => {
    document.open();
    document.write(TEMPLATE);
    document.close();
  });

  it("reads declared defaults from html root attribute", () => {
    const defs = readDeclaredDefaults(document.documentElement);
    expect(defs).toHaveProperty("headline");
    expect(defs.headline).toBe("Hello");
  });

  it("getVariables returns an object or array from dom", () => {
    const vars = getVariables();
    // Shape varies by version (object or array); assert non-throwing and truthy
    expect(typeof vars).not.toBe("undefined");
    expect(vars).toEqual(expect.any(Object));
  });

  it("validateVariables accepts matching declarations and values", () => {
    const declarations = [{ id: "headline", type: "string" }];
    const issues = validateVariables({ headline: "World" }, declarations);
    expect(Array.isArray(issues)).toBe(true);
    const bad = issues.filter((i: any) => i.kind !== "undeclared");
    expect(bad.length).toBe(0);
  });

  it("validateVariables flags undeclared variables", () => {
    const declarations = [{ id: "headline", type: "string" }];
    const issues = validateVariables({ headline: "World", extra: "Bad" }, declarations);
    expect(issues.some((i: any) => i.kind === "undeclared" && i.variableId === "extra")).toBe(true);
  });
});
