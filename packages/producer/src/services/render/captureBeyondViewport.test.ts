import { describe, expect, it } from "vitest";
import { resolveVideoCaptureBeyondViewport } from "./captureBeyondViewport.js";

describe("resolveVideoCaptureBeyondViewport", () => {
  it("leaves no-video renders on the engine default", () => {
    expect(resolveVideoCaptureBeyondViewport(0)).toBeUndefined();
  });

  it("forces beyond-viewport for any video render so the bottom edge is not clipped", () => {
    // Regression: software hosts (including every distributed chunk render,
    // which resolves as "software") previously returned false here and clipped
    // ~87 bottom rows to black on video comps.
    expect(resolveVideoCaptureBeyondViewport(1)).toBe(true);
    expect(resolveVideoCaptureBeyondViewport(5)).toBe(true);
  });
});
