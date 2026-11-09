import { describe, expect, it } from "vitest";
import { ago } from "./historyAgo.js";

describe("ago", () => {
  const at = 1_000_000_000_000;
  const after = (seconds: number) => ago(at, at + seconds * 1000);

  it("counts whole seconds, minutes, hours and days", () => {
    expect(after(0)).toBe("0s ago");
    expect(after(59)).toBe("59s ago");
    expect(after(3600)).toBe("1h ago");
    expect(after(86_400)).toBe("1d ago");
    expect(after(3 * 86_400)).toBe("3d ago");
  });

  it("never prints a unit at the size of the next one", () => {
    expect(after(3570)).toBe("59m ago");
    expect(after(86_000)).toBe("23h ago");
  });

  it("treats a future timestamp as now", () => {
    expect(ago(at + 5000, at)).toBe("0s ago");
  });
});
