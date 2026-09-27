import { describe, expect, it, vi } from "vitest";

const telemetry = vi.hoisted(() => ({
  trackEvent: vi.fn(),
  flush: vi.fn(async () => {}),
  flushSync: vi.fn(),
}));
vi.mock("../telemetry/client.js", () => telemetry);

describe("events", () => {
  it("hands anything flush() left queued to the detached sender", async () => {
    const { default: events } = await import("./events.js");
    await events.run?.({ args: { skill: "hyperframes", event: "skill_invoked" } } as never);
    expect(telemetry.trackEvent).toHaveBeenCalled();
    expect(telemetry.flushSync).toHaveBeenCalled();
  });
});
