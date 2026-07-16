import { describe, expect, it } from "vitest";
import { formatRenderOutputTimestamp } from "./renderOutputTimestamp.js";

describe("formatRenderOutputTimestamp", () => {
  it.each([
    ["late local evening", "2026-07-14T22:55:06-07:00", "2026-07-14_22-55-06"],
    ["single-digit calendar and clock fields", "2026-01-05T04:07:03-08:00", "2026-01-05_04-07-03"],
  ])("uses one padded local calendar for %s", (_name, input, expected) => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";

    try {
      expect(formatRenderOutputTimestamp(new Date(input))).toBe(expected);
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });
});
