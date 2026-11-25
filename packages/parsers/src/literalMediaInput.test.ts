import { describe, expect, it } from "vitest";
import { assertLiteralMediaInput, assertLiteralMediaOutput } from "./literalMediaInput.js";

describe("assertLiteralMediaInput", () => {
  // fails without the fix: every scheme but file: skipped the check, as if another check had vetted it.
  it("checks a scheme-led name as a local one; only http and https are left to the caller", () => {
    for (const path of [
      "concat:/a/b%d.png",
      "subfile,,start,0,end,0,,:/a/b%d.png",
      "data:/a%d.png",
    ]) {
      expect(() => assertLiteralMediaInput(path)).toThrow(/pattern of other files/);
      expect(() => assertLiteralMediaOutput(path)).toThrow(/pattern of other files/);
    }
    for (const path of [
      "https://cdn.example/a%2d.png",
      "HTTP://cdn.example/a%2d.png",
      "/a/clip.mp4",
    ])
      expect(() => assertLiteralMediaInput(path)).not.toThrow();
  });
});
