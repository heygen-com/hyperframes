import { describe, expect, it } from "vitest";
import { buildChromeArgs } from "@hyperframes/engine";
import { parityChromeArgs } from "./parity-harness.js";

describe("parityChromeArgs", () => {
  it("launches Chrome with a screenshot render's flags", () => {
    expect(parityChromeArgs(1280, 720)).toEqual(
      buildChromeArgs({ width: 1280, height: 720, captureMode: "screenshot", sandbox: false }),
    );
  });
});
