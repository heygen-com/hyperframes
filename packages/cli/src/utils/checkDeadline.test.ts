import { afterEach, expect, it, vi } from "vitest";
import {
  CheckDeadline,
  CheckDeadlineError,
  CheckStoppedError,
  idleWindow,
} from "./checkDeadline.js";

afterEach(() => vi.useRealTimers());

function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });
}

it("an idle check ends 120 s after its last progress", async () => {
  vi.useFakeTimers();
  const deadline = new CheckDeadline();
  deadline.start();
  try {
    await deadline.run(async () => "ready");
    await vi.advanceTimersByTimeAsync(90_000);
    const sample = deadline.run(() => rejectOnAbort(deadline.signal));
    const failed = expect(sample).rejects.toBeInstanceOf(CheckDeadlineError);
    await vi.advanceTimersByTimeAsync(30_000);
    await failed;
    expect(deadline.signal.aborted).toBe(true);
  } finally {
    await deadline.close();
  }
});

it("an expired check does not start its crop browser", async () => {
  vi.useFakeTimers();
  const deadline = new CheckDeadline();
  deadline.start();
  try {
    const audit = deadline.run(() => rejectOnAbort(deadline.signal));
    const failed = expect(audit).rejects.toBeInstanceOf(CheckDeadlineError);
    await vi.advanceTimersByTimeAsync(120_000);
    await failed;
    const crop = vi.fn(async () => []);
    await expect(deadline.run(crop)).rejects.toBeInstanceOf(CheckDeadlineError);
    expect(crop).not.toHaveBeenCalled();
  } finally {
    await deadline.close();
  }
});

it("cleanup is bounded even when a losing operation ignores cancellation", async () => {
  vi.useFakeTimers();
  const deadline = new CheckDeadline();
  deadline.start();
  const audit = deadline.run(() => new Promise(() => {}));
  const failed = expect(audit).rejects.toBeInstanceOf(CheckDeadlineError);
  await vi.advanceTimersByTimeAsync(120_000);
  await failed;
  const closing = expect(deadline.close()).rejects.toThrow("draining check cleanup");
  await vi.advanceTimersByTimeAsync(1_000);
  await closing;
}, 2_000);

it("browser provisioning does not spend the check budget, which starts once when ready", async () => {
  vi.useFakeTimers();
  const deadline = new CheckDeadline();
  let complete!: () => void;
  const work = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const outcome = deadline.run(() => work).catch((error: unknown) => error);
  try {
    await vi.advanceTimersByTimeAsync(150_000);
    expect(deadline.signal.aborted).toBe(false);
    deadline.start();
    await vi.advanceTimersByTimeAsync(90_000);
    deadline.start();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(deadline.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(deadline.signal.aborted).toBe(true);
    expect(await outcome).toBeInstanceOf(CheckDeadlineError);
  } finally {
    complete();
    await outcome;
    await deadline.close();
  }
});

it("closing before browser readiness prevents a later clock from starting", async () => {
  vi.useFakeTimers();
  const deadline = new CheckDeadline();
  await deadline.close();
  deadline.start();
  await vi.advanceTimersByTimeAsync(150_000);
  expect(vi.getTimerCount()).toBe(0);
  expect(deadline.signal.aborted).toBe(false);
});

it("an expired check names the phase it was in and the seconds each phase took", async () => {
  vi.useFakeTimers();
  const deadline = new CheckDeadline();
  const outcome = deadline
    .run(() => rejectOnAbort(deadline.signal))
    .catch((error: unknown) => error);
  try {
    deadline.enter("copies");
    await vi.advanceTimersByTimeAsync(247_000);
    deadline.enter("launch");
    await vi.advanceTimersByTimeAsync(2_000);
    deadline.start();
    await vi.advanceTimersByTimeAsync(3_000);
    deadline.enter("settle");
    await vi.advanceTimersByTimeAsync(60_000);
    deadline.enter("samples");
    await vi.advanceTimersByTimeAsync(50_000);
    deadline.enter("overlap");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(((await outcome) as Error).message).toBe(
      "Check did not finish within its deadline (no progress for 120 s after Chrome was ready), while running the overlap pass. " +
        "Seconds per phase: making video copies 247.0 (before the deadline), starting Chrome 2.0 (before the deadline), " +
        "loading the page 3.0, waiting for the page to be ready 60.0, checking samples 50.0, running the overlap pass 120.0.",
    );
  } finally {
    await deadline.close();
  }
});

it("keeps going while each step makes progress, and ends once none does", async () => {
  vi.useFakeTimers();
  const deadline = new CheckDeadline();
  const outcome = deadline
    .run(() => rejectOnAbort(deadline.signal))
    .catch((error: unknown) => error);
  try {
    deadline.start();
    for (let step = 0; step < 10; step++) {
      await vi.advanceTimersByTimeAsync(90_000);
      deadline.enter("overlap");
    }
    expect(deadline.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await outcome).toBeInstanceOf(CheckDeadlineError);
  } finally {
    await deadline.close();
  }
});

it("an operation that settles restarts the idle clock", async () => {
  vi.useFakeTimers();
  const deadline = new CheckDeadline();
  try {
    deadline.start();
    await vi.advanceTimersByTimeAsync(100_000);
    await deadline.run(async () => "done");
    await vi.advanceTimersByTimeAsync(100_000);
    expect(deadline.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(deadline.signal.aborted).toBe(true);
  } finally {
    await deadline.close();
  }
});

it("a stop ends the check at once, keeping what it already found", async () => {
  vi.useFakeTimers();
  const deadline = new CheckDeadline();
  deadline.start();
  deadline.keepPartial(() => ({ screenshots: [] }));
  try {
    const sample = deadline.run(() => rejectOnAbort(deadline.signal));
    const failed = expect(sample).rejects.toThrow("Check stopped before finishing (SIGTERM).");
    deadline.stop("SIGTERM");
    await failed;
    await expect(deadline.run(async () => "late")).rejects.toBeInstanceOf(CheckStoppedError);
    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.partialResult()).toEqual({ screenshots: [] });
  } finally {
    await deadline.close();
  }
});

it("an expired check names the step it was on", async () => {
  vi.useFakeTimers();
  const deadline = new CheckDeadline();
  deadline.start();
  try {
    deadline.enter("samples", "layout sample at 2.5s");
    const sample = deadline.run(() => rejectOnAbort(deadline.signal));
    const failed = expect(sample).rejects.toThrow(
      "while checking samples (layout sample at 2.5s). Seconds per phase",
    );
    await vi.advanceTimersByTimeAsync(120_000);
    await failed;
  } finally {
    await deadline.close();
  }
});

it("a check waits as long as the --timeout it was given before it counts as idle, and says so", async () => {
  vi.useFakeTimers();
  expect(idleWindow(10_000)).toBe(120_000);
  expect(idleWindow(400_000)).toBe(410_000);
  const deadline = new CheckDeadline(idleWindow(400_000));
  deadline.start();
  try {
    const sample = deadline.run(() => rejectOnAbort(deadline.signal));
    const failed = expect(sample).rejects.toThrow("no progress for 410 s");
    await vi.advanceTimersByTimeAsync(300_000);
    expect(deadline.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(110_000);
    await failed;
  } finally {
    await deadline.close();
  }
});
