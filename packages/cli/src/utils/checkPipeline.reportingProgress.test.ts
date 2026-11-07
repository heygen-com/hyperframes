import { afterEach, describe, expect, it, vi } from "vitest";
import { CheckDeadline, CheckDeadlineError } from "./checkDeadline.js";
import { reportingProgress } from "./checkPipeline.js";

afterEach(() => vi.useRealTimers());

const IDLE_MS = 300;
const STEP_MS = 200;

/** Three analysis steps that each finish inside the idle window but together outlast it. */
async function analyse(step: () => Promise<void>, deadline: CheckDeadline): Promise<void> {
  const work = deadline.run(async () => {
    for (let i = 0; i < 3; i++) await step();
  });
  const settled = work.then(
    () => "finished",
    (error: unknown) => error,
  );
  await vi.advanceTimersByTimeAsync(IDLE_MS * 4);
  expect(await settled).toBe("finished");
}

describe("reportingProgress", () => {
  it("restarts the idle window on every call the analysis makes", async () => {
    vi.useFakeTimers();
    const deadline = new CheckDeadline(IDLE_MS);
    deadline.start();
    const driver = { seek: () => new Promise<void>((done) => setTimeout(done, STEP_MS)) };
    const watched = reportingProgress(driver, deadline.enter);

    await analyse(() => watched.seek(), deadline);
  });

  it("ends a step that makes no call for the whole window, naming the analysis", async () => {
    vi.useFakeTimers();
    const deadline = new CheckDeadline(IDLE_MS);
    deadline.start();
    deadline.enter("analysis");
    const silent = deadline.run(() => new Promise<void>(() => undefined));
    const outcome = silent.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(IDLE_MS + 1);

    const error = await outcome;
    expect(error).toBeInstanceOf(CheckDeadlineError);
    expect((error as Error).message).toContain("analyzing the samples");
  });

  it("passes arguments and results through and leaves other members alone", async () => {
    const enter = vi.fn();
    const driver = { label: "x", add: async (a: number, b: number) => a + b, optional: undefined };
    const watched = reportingProgress(driver, enter);

    expect(await watched.add(2, 3)).toBe(5);
    expect(watched.label).toBe("x");
    expect(watched.optional).toBeUndefined();
    expect(enter).toHaveBeenCalledWith("analysis", "add");
  });
});
