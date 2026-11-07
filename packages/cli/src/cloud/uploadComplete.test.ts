import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HyperframesApiError } from "./_gen/client.js";
import type { HyperframesCloudClient } from "./_gen/client.js";
import { completeBudgetMs, completeWithRetry } from "./upload.js";

const MIB = 1024 * 1024;
const stillChecking = () =>
  new HyperframesApiError({
    status: 409,
    code: "resource_not_ready",
    message: "still being checked",
  });

function clientAnswering(...answers: Array<"409" | Error | "ok">) {
  const complete = vi.fn(async () => {
    const next = answers.shift() ?? "409";
    if (next === "ok") return { asset_id: "a1", url: "u" };
    throw next === "409" ? stillChecking() : next;
  });
  return {
    client: { completeAssetUpload: complete } as unknown as HyperframesCloudClient,
    complete,
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("completeWithRetry waits for the check as long as the file's size allows", () => {
  it("scales the wait with the size, between the base and the cap", () => {
    expect(completeBudgetMs(1 * MIB)).toBeCloseTo(30_500);
    expect(completeBudgetMs(600 * MIB)).toBe(330_000);
    expect(completeBudgetMs(100_000 * MIB)).toBe(600_000);
  });

  it("keeps polling through more than a minute of 409s on a big file, then returns the asset", async () => {
    const { client, complete } = clientAnswering(
      ...Array.from({ length: 20 }, () => "409" as const),
      "ok",
    );

    const done = completeWithRetry(client, "a1", "sha", 600 * MIB);
    await vi.advanceTimersByTimeAsync(120_000);

    await expect(done).resolves.toEqual({ asset_id: "a1", url: "u" });
    expect(complete.mock.calls.length).toBeGreaterThan(5);
  });

  it("gives up with a clear message once the budget for a small file is spent", async () => {
    const { client } = clientAnswering();

    const done = completeWithRetry(client, "a1", "sha", 1 * MIB);
    const failed = expect(done).rejects.toThrow(
      /uploaded, but the cloud had not finished checking it after 31 s/,
    );
    await vi.advanceTimersByTimeAsync(40_000);

    await failed;
  });

  it("stops at once on an answer that is not a 409", async () => {
    const refused = new HyperframesApiError({
      status: 400,
      code: "invalid_parameter",
      message: "bad checksum",
    });
    const { client, complete } = clientAnswering(refused);

    await expect(completeWithRetry(client, "a1", "sha", 1 * MIB)).rejects.toBe(refused);
    expect(complete).toHaveBeenCalledOnce();
  });

  it("stops waiting when the caller aborts", async () => {
    const { client, complete } = clientAnswering();
    const controller = new AbortController();

    const done = completeWithRetry(client, "a1", "sha", 600 * MIB, controller.signal);
    const aborted = expect(done).rejects.toThrow(/Stopped waiting for the cloud/);
    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort(new Error("cancelled"));
    await vi.advanceTimersByTimeAsync(1);

    await aborted;
    expect(complete.mock.calls.length).toBeLessThan(6);
  });
});
