import { afterEach, expect, it, vi } from "vitest";
import { markTimelineMotion, TIMELINE_REST_MS, whenTimelineIdle } from "./timelineMotion";

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

it("waits for a zoom to rest before resolving, and resolves at once when nothing moves", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestIdleCallback"] });
  markTimelineMotion();
  let idle = false;
  void whenTimelineIdle().then(() => (idle = true));
  await vi.advanceTimersByTimeAsync(TIMELINE_REST_MS - 50);
  expect(idle).toBe(false);
  // Another zoom step pushes the rest back.
  markTimelineMotion();
  await vi.advanceTimersByTimeAsync(TIMELINE_REST_MS - 50);
  expect(idle).toBe(false);
  await vi.advanceTimersByTimeAsync(TIMELINE_REST_MS);
  expect(idle).toBe(true);

  let again = false;
  void whenTimelineIdle().then(() => (again = true));
  await vi.advanceTimersByTimeAsync(1);
  expect(again).toBe(true);
});
