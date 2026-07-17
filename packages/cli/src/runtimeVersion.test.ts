import { describe, expect, it } from "vitest";
import { runtimeVersionError } from "./runtimeVersion.js";

describe("runtimeVersionError", () => {
  it("rejects Node 20 before the bundled CLI is imported", () => {
    expect(runtimeVersionError("20.11.1")).toBe(
      "HyperFrames requires Node.js >= 22 (current: 20.11.1). Switch Node versions and retry.",
    );
  });

  it("accepts supported Node releases", () => {
    expect(runtimeVersionError("22.0.0")).toBeNull();
    expect(runtimeVersionError("24.14.0")).toBeNull();
  });

  it("rejects malformed versions safely", () => {
    expect(runtimeVersionError("unknown")).toContain("requires Node.js >= 22");
  });
});
