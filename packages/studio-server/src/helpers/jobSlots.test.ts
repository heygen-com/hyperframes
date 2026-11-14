import { describe, expect, it } from "vitest";
import { createJobSlots, JobSlotsFullError } from "./jobSlots.js";

const gate = () => {
  let open: () => void = () => {};
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
};

describe("createJobSlots", () => {
  it("refuses a job once the slots and the queue are full", async () => {
    const run = createJobSlots(1, 1);
    const first = gate();
    const running = run(() => first.opened);
    const queued = run(async () => "queued");
    await expect(run(async () => "third")).rejects.toBeInstanceOf(JobSlotsFullError);
    first.open();
    await running;
    await expect(queued).resolves.toBe("queued");
  });

  it("drops a queued job whose request went away, and frees its place", async () => {
    const run = createJobSlots(1, 1);
    const first = gate();
    const running = run(() => first.opened);
    const gone = new AbortController();
    let started = false;
    const abandoned = run(async () => {
      started = true;
    }, gone.signal);
    gone.abort();
    await expect(abandoned).rejects.toBeDefined();
    const next = run(async () => "next");
    first.open();
    await running;
    await expect(next).resolves.toBe("next");
    expect(started).toBe(false);
  });
});
