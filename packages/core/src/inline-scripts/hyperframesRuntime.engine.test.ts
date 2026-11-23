// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildHyperframesRuntimeScript } from "./hyperframesRuntime.engine";

describe("buildHyperframesRuntimeScript", () => {
  it("reaches console through globalThis so a composition's own `const console` cannot break it", () => {
    const script = buildHyperframesRuntimeScript({ minify: false });
    expect(script).toContain("globalThis.console.info(");
  });
});
