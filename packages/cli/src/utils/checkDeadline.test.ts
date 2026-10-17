import { TimeoutError, type Page } from "puppeteer-core";
import { afterEach, expect, it, vi } from "vitest";
import { CheckDeadline, CheckDeadlineError } from "./checkDeadline.js";

afterEach(() => vi.useRealTimers());

function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });
}

it("readiness and later sampling spend one 120-second budget", async () => {
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

/** A deadline whose page has said a composition's script started and not finished, or none. */
async function deadlineWithRunningScript(running: string | null): Promise<CheckDeadline> {
  const deadline = new CheckDeadline();
  const listeners: Array<(message: { text(): string }) => void> = [];
  const page = {
    on: (_event: string, listener: (message: { text(): string }) => void) =>
      listeners.push(listener),
    evaluateOnNewDocument: async () => {},
  };
  await deadline.preparePage(page as unknown as Page);
  deadline.start();
  if (running)
    for (const listener of listeners)
      listener({ text: () => `[hyperframes:script:start] ${running}` });
  return deadline;
}

const loadTimesOut = () =>
  Promise.reject(new TimeoutError("Navigation timeout of 10000 ms exceeded"));

it("a page load that times out while a composition's script runs names that script, as the deadline would", async () => {
  const deadline = await deadlineWithRunningScript("compositions/hang.html");
  try {
    const failed = deadline.run(loadTimesOut);
    await expect(failed).rejects.toBeInstanceOf(CheckDeadlineError);
    await expect(failed).rejects.toMatchObject({
      sourceFile: "compositions/hang.html",
      message: expect.stringContaining("script did not finish"),
    });
  } finally {
    await deadline.close();
  }
});

it("a page load that times out with no script running stays a navigation timeout", async () => {
  const deadline = await deadlineWithRunningScript(null);
  try {
    await expect(deadline.run(loadTimesOut)).rejects.toBeInstanceOf(TimeoutError);
  } finally {
    await deadline.close();
  }
});
