import { describe, expect, it } from "vitest";
import { formatRenderOutputTimestamp } from "./renderOutputTimestamp.js";

describe("formatRenderOutputTimestamp", () => {
  it("uses one local calendar for the date and time", () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";

    try {
      const lateLocalEvening = new Date("2026-07-14T22:55:06-07:00");
      expect(formatRenderOutputTimestamp(lateLocalEvening)).toBe("2026-07-14_22-55-06");
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });
});
