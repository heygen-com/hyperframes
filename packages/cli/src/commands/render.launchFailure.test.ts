import { describe, expect, it } from "vitest";
import { chromeLaunchFailure } from "./render.js";

describe("chromeLaunchFailure", () => {
  it("names a sandbox that refused Chrome, with its remediation", () => {
    const failure = chromeLaunchFailure(
      "Failed to launch: bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer: Permission denied (1100)",
    );
    expect(failure?.title).toBe("Render failed — Chrome could not launch");
    expect(failure?.remediation).toContain("outside the sandbox");
  });

  it("leaves a failure that is not a launch problem to the generic message", () => {
    expect(chromeLaunchFailure("Composition has no duration")).toBeNull();
  });
});
