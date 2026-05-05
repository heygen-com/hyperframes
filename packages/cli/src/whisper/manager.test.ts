import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL } from "./manager.js";

describe("DEFAULT_MODEL", () => {
  it("uses a multilingual model by default", () => {
    expect(DEFAULT_MODEL).toBe("small");
    expect(DEFAULT_MODEL.endsWith(".en")).toBe(false);
  });
});
