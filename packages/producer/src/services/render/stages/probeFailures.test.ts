import { describe, expect, it } from "bun:test";
import { isActionableProbeFailure } from "./probeFailures.js";

describe("isActionableProbeFailure", () => {
  it("ignores favicon 404 noise without hiding real asset failures", () => {
    expect(
      isActionableProbeFailure(
        "[Browser:HTTP404] GET http://127.0.0.1:4173/favicon.ico resource=image",
      ),
    ).toBe(false);
    expect(
      isActionableProbeFailure(
        "[Browser:HTTP404] GET http://127.0.0.1:4173/assets/missing.png resource=image",
      ),
    ).toBe(true);
    expect(
      isActionableProbeFailure(
        "[Browser:REQUESTFAILED] GET http://127.0.0.1:4173/assets/app.js resource=script error=net::ERR_FAILED",
      ),
    ).toBe(true);
  });
});
