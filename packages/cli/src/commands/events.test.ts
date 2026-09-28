import { describe, expect, it, vi } from "vitest";

const order: string[] = [];
const telemetry = vi.hoisted(() => ({
  trackEvent: vi.fn(),
  flush: vi.fn(async () => {}),
  flushSync: vi.fn(),
}));
vi.mock("../telemetry/client.js", () => telemetry);

describe("events", () => {
  it("queues the event, then hands it to the detached sender without waiting on the network", async () => {
    telemetry.trackEvent.mockImplementation(() => order.push("track"));
    telemetry.flushSync.mockImplementation(() => order.push("flushSync"));
    const { default: events } = await import("./events.js");
    await events.run?.({ args: { skill: "hyperframes", event: "skill_invoked" } } as never);
    expect(order).toEqual(["track", "flushSync"]);
    expect(telemetry.flush).not.toHaveBeenCalled();
  });
});
