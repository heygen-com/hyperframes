import { describe, expect, it } from "vitest";
import { createJobSlots, JobAbandonedError } from "./jobSlots.js";

const gate = () => {
  let open: () => void = () => {};
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
};

describe("createJobSlots", () => {
  it("queues jobs past the limit and runs them as slots free", async () => {
    const run = createJobSlots(1);
    const first = gate();
    const running = run(() => first.opened);
    const queued = [run(async () => "second"), run(async () => "third")];
    first.open();
    await running;
    await expect(Promise.all(queued)).resolves.toEqual(["second", "third"]);
  });

  it("drops a queued job whose request went away, and frees its place", async () => {
    const run = createJobSlots(1);
    const first = gate();
    const running = run(() => first.opened);
    const gone = new AbortController();
    let started = false;
    const abandoned = run(async () => {
      started = true;
    }, gone.signal);
    gone.abort();
    await expect(abandoned).rejects.toBeInstanceOf(JobAbandonedError);
    const next = run(async () => "next");
    first.open();
    await running;
    await expect(next).resolves.toBe("next");
    expect(started).toBe(false);
  });
});
