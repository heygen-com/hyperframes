import { describe, expect, it } from "vitest";
import { resolveVideoCaptureBeyondViewport } from "./captureBeyondViewport.js";

describe("resolveVideoCaptureBeyondViewport", () => {
  it("leaves no-video renders on the engine default", () => {
    expect(resolveVideoCaptureBeyondViewport(0, "software")).toBeUndefined();
    expect(resolveVideoCaptureBeyondViewport(0, "hardware")).toBeUndefined();
  });

  it("keeps video renders on the fast viewport-bound path under software rendering", () => {
    expect(resolveVideoCaptureBeyondViewport(1, "software")).toBe(false);
  });

  it("preserves the beyond-viewport video workaround under hardware rendering", () => {
    expect(resolveVideoCaptureBeyondViewport(1, "hardware")).toBe(true);
  });
});
