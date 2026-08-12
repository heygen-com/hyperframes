import { describe, expect, it, vi } from "vitest";
import { TimeoutError } from "puppeteer-core";
import {
  isNavigationTimeoutError,
  navigateForCapture,
  networkIdleAttemptTimeoutMs,
  NETWORK_IDLE_ATTEMPT_MS,
} from "./navigateForCapture.js";

describe("networkIdleAttemptTimeoutMs", () => {
  it("caps at the network-idle attempt budget", () => {
    expect(networkIdleAttemptTimeoutMs(120_000)).toBe(NETWORK_IDLE_ATTEMPT_MS);
  });

  it("honors a caller timeout below the attempt budget", () => {
    expect(networkIdleAttemptTimeoutMs(10_000)).toBe(10_000);
  });
});

describe("isNavigationTimeoutError", () => {
  it("matches Puppeteer TimeoutError navigation timeouts", () => {
    expect(
      isNavigationTimeoutError(new TimeoutError("Navigation timeout of 30000 ms exceeded")),
    ).toBe(true);
  });

  it("ignores unrelated failures", () => {
    expect(isNavigationTimeoutError(new Error("net::ERR_NAME_NOT_RESOLVED"))).toBe(false);
  });
});

describe("navigateForCapture", () => {
  it("returns after networkidle2 when the page settles", async () => {
    const response = { status: () => 200 };
    const goto = vi.fn().mockResolvedValue(response);
    const result = await navigateForCapture({ goto }, "https://example.com", 120_000);

    expect(result).toEqual({
      response,
      waitUntil: "networkidle2",
      networkIdleTimeoutMs: NETWORK_IDLE_ATTEMPT_MS,
      fellBackFromNetworkIdle: false,
    });
    expect(goto).toHaveBeenCalledTimes(1);
    expect(goto).toHaveBeenCalledWith("https://example.com", {
      waitUntil: "networkidle2",
      timeout: NETWORK_IDLE_ATTEMPT_MS,
    });
  });

  it("falls back to domcontentloaded after a networkidle2 navigation timeout", async () => {
    const response = { status: () => 200 };
    const goto = vi
      .fn()
      .mockRejectedValueOnce(new TimeoutError("Navigation timeout of 30000 ms exceeded"))
      .mockResolvedValueOnce(response);

    const result = await navigateForCapture({ goto }, "https://www.yahoo.com/", 120_000);

    expect(result).toEqual({
      response,
      waitUntil: "domcontentloaded",
      networkIdleTimeoutMs: NETWORK_IDLE_ATTEMPT_MS,
      fellBackFromNetworkIdle: true,
    });
    expect(goto).toHaveBeenNthCalledWith(1, "https://www.yahoo.com/", {
      waitUntil: "networkidle2",
      timeout: NETWORK_IDLE_ATTEMPT_MS,
    });
    expect(goto).toHaveBeenNthCalledWith(2, "https://www.yahoo.com/", {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
  });

  it.each([
    { totalTimeoutMs: 31_000, fallbackTimeoutMs: 1_000 },
    { totalTimeoutMs: 45_000, fallbackTimeoutMs: 15_000 },
  ])(
    "uses only the remaining budget for fallback when totalTimeoutMs=$totalTimeoutMs",
    async ({ totalTimeoutMs, fallbackTimeoutMs }) => {
      const response = { status: () => 200 };
      const goto = vi
        .fn()
        .mockRejectedValueOnce(new TimeoutError("Navigation timeout of 30000 ms exceeded"))
        .mockResolvedValueOnce(response);

      await navigateForCapture({ goto }, "https://www.yahoo.com/", totalTimeoutMs);

      expect(goto).toHaveBeenNthCalledWith(1, "https://www.yahoo.com/", {
        waitUntil: "networkidle2",
        timeout: NETWORK_IDLE_ATTEMPT_MS,
      });
      expect(goto).toHaveBeenNthCalledWith(2, "https://www.yahoo.com/", {
        waitUntil: "domcontentloaded",
        timeout: fallbackTimeoutMs,
      });
    },
  );

  it("does not fall back for non-timeout navigation errors", async () => {
    const err = new Error("net::ERR_CONNECTION_REFUSED");
    const goto = vi.fn().mockRejectedValue(err);

    await expect(navigateForCapture({ goto }, "https://example.com", 120_000)).rejects.toBe(err);
    expect(goto).toHaveBeenCalledTimes(1);
  });

  it("does not fall back when the caller timeout already equals the idle attempt", async () => {
    const err = new TimeoutError("Navigation timeout of 10000 ms exceeded");
    const goto = vi.fn().mockRejectedValue(err);

    await expect(navigateForCapture({ goto }, "https://example.com", 10_000)).rejects.toBe(err);
    expect(goto).toHaveBeenCalledWith("https://example.com", {
      waitUntil: "networkidle2",
      timeout: 10_000,
    });
  });
});
