// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MAX_FREEZE_BYTES } from "./index";

describe("figma barrel", () => {
  it("re-exports the freeze cap constant", () => {
    expect(MAX_FREEZE_BYTES).toBe(256 * 1024 * 1024);
  });
});
