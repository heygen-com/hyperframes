import { describe, expect, it } from "vitest";
import { normalizeDomString } from "./webCaptureCanonicalJson";

describe("normalizeDomString", () => {
  it("keeps a clipboard-sized base64 string flat while repairing lone surrogates", () => {
    const base64 = "A".repeat(6_500_000);
    expect(normalizeDomString(base64)).toBe(base64);
    expect(normalizeDomString(`before\ud800after\udc00`)).toBe("before\ufffdafter\ufffd");
  });
});
