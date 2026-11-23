import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const generatedClientSource = readFileSync(new URL("./_gen/client.ts", import.meta.url), "utf8");

describe("generated cloud client source contract", () => {
  it("carries no API description text on its methods", () => {
    expect(generatedClientSource).toMatch(/async uploadAsset\(/);
    expect(generatedClientSource).not.toMatch(/\*\/\s+async \w+\(/);
  });
});
