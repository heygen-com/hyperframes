import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("blank template", () => {
  it("starts on a black frame", () => {
    const html = readFileSync(new URL("./blank/index.html", import.meta.url), "utf8");
    expect(html).toMatch(/--ground:\s*#000;/);
  });
});
