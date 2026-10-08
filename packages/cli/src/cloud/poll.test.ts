import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MAX_WAIT_MS,
  DEFAULT_POLL_INTERVAL_MS,
  PollTimeoutError,
  isTerminal,
  pollUntilTerminal,
} from "./poll.js";
import type { HyperframesCloudClient } from "./_gen/client.js";
import type { HyperframesRenderDetail } from "./_gen/types.js";

function makeDetail(overrides: Partial<HyperframesRenderDetail>): HyperframesRenderDetail {
  return {
    render_id: "hfr_test",
    status: "queued",
    format: "mp4",
    ...overrides,
  };
}

/** Build a stub client that returns the supplied details in order. */
function stubClient(details: HyperframesRenderDetail[]): HyperframesCloudClient {
  const stack = [...details];
  return {
    async getRender() {
      const next = stack.shift();
      if (!next) throw new Error("ran out of stubbed responses");
      return next;
    },
  } as unknown as HyperframesCloudClient;
}

describe("cloud/poll", () => {
  describe("isTerminal", () => {
    it("treats completed/failed as terminal", () => {
      expect(isTerminal("completed")).toBe(true);
      expect(isTerminal("failed")).toBe(true);
    });
    it("treats queued/rendering as non-terminal", () => {
      expect(isTerminal("queued")).toBe(false);
      expect(isTerminal("rendering")).toBe(false);
    });
  });

  describe("defaults", () => {
    it("matches the documented 10s / 60min defaults", () => {
      expect(DEFAULT_POLL_INTERVAL_MS).toBe(10_000);
      expect(DEFAULT_MAX_WAIT_MS).toBe(60 * 60 * 1000);
    });
  });

  describe("pollUntilTerminal", () => {
    it("returns immediately when the first poll is terminal", async () => {
      const client = stubClient([makeDetail({ status: "completed" })]);
      const sleep = vi.fn(async () => {});
      const result = await pollUntilTerminal(client, "hfr_test", { sleep });
      expect(result.status).toBe("completed");
      expect(sleep).not.toHaveBeenCalled();
    });

    it("sleeps between non-terminal polls and returns on the terminal one", async () => {
      const client = stubClient([
        makeDetail({ status: "queued" }),
        makeDetail({ status: "rendering" }),
        makeDetail({ status: "completed" }),
      ]);
      const sleep = vi.fn(async () => {});
      const now = (() => {
        let t = 0;
        return () => {
          t += 1000;
          return t;
        };
      })();
      const ticks: string[] = [];
      const result = await pollUntilTerminal(client, "hfr_test", {
        sleep,
        now,
        intervalMs: 5_000,
        onTick: (d) => ticks.push(d.status),
      });
      expect(result.status).toBe("completed");
      expect(ticks).toEqual(["queued", "rendering", "completed"]);
      // Two sleeps: one after queued, one after rendering. None after the
      // terminal completed response.
      expect(sleep).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenCalledWith(5_000);
    });

    it("throws PollTimeoutError when elapsed exceeds maxWaitMs", async () => {
      const client = stubClient([
        makeDetail({ status: "queued" }),
        makeDetail({ status: "rendering" }),
        makeDetail({ status: "rendering" }),
      ]);
      const sleep = vi.fn(async () => {});
      // Each `now()` returns +500ms; total elapses past 1s on the second
      // call, so maxWaitMs=1 triggers immediately.
      const now = (() => {
        let t = 0;
        return () => {
          t += 1000;
          return t;
        };
      })();
      await expect(
        pollUntilTerminal(client, "hfr_test", {
          sleep,
          now,
          intervalMs: 5_000,
          maxWaitMs: 1,
        }),
      ).rejects.toBeInstanceOf(PollTimeoutError);
    });

    it.each([
      { reason: new Error("user cancelled"), message: "user cancelled" },
      { reason: "user cancelled", message: "Poll aborted" },
    ])("rejects without waiting when onTick aborts ($message)", async ({ reason, message }) => {
      vi.useFakeTimers();
      const client = stubClient([makeDetail({ status: "queued" })]);
      const getRender = vi.spyOn(client, "getRender");
      const controller = new AbortController();
      let settled = false;
      let rejection: unknown;
      const polling = pollUntilTerminal(client, "hfr_test", {
        signal: controller.signal,
        onTick: () => controller.abort(reason),
      }).then(
        () => {
          settled = true;
        },
        (error: unknown) => {
          settled = true;
          rejection = error;
        },
      );
      try {
        await vi.advanceTimersByTimeAsync(0);
        expect(settled).toBe(true);
        expect(rejection).toBeInstanceOf(Error);
        expect(rejection).toHaveProperty("message", message);
        if (reason instanceof Error) expect(rejection).toBe(reason);
        expect(vi.getTimerCount()).toBe(0);
        expect(getRender).toHaveBeenCalledTimes(1);
      } finally {
        await vi.runAllTimersAsync();
        await polling;
        vi.useRealTimers();
      }
    });

    it("aborts an active polling interval immediately", async () => {
      vi.useFakeTimers();
      const client = stubClient([makeDetail({ status: "queued" })]);
      const getRender = vi.spyOn(client, "getRender");
      const controller = new AbortController();
      const reason = new Error("cancel during wait");
      let rejection: unknown;
      const polling = pollUntilTerminal(client, "hfr_test", { signal: controller.signal }).catch(
        (error: unknown) => {
          rejection = error;
        },
      );
      try {
        await vi.advanceTimersByTimeAsync(0);
        expect(vi.getTimerCount()).toBe(1);
        controller.abort(reason);
        await vi.advanceTimersByTimeAsync(0);
        expect(rejection).toBe(reason);
        expect(vi.getTimerCount()).toBe(0);
        expect(getRender).toHaveBeenCalledTimes(1);
      } finally {
        await vi.runAllTimersAsync();
        await polling;
        vi.useRealTimers();
      }
    });

    it("continues polling after a normal interval with an active signal", async () => {
      vi.useFakeTimers();
      const client = stubClient([
        makeDetail({ status: "queued" }),
        makeDetail({ status: "completed" }),
      ]);
      const getRender = vi.spyOn(client, "getRender");
      const controller = new AbortController();
      const polling = pollUntilTerminal(client, "hfr_test", { signal: controller.signal });
      try {
        await vi.advanceTimersByTimeAsync(0);
        expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(DEFAULT_POLL_INTERVAL_MS);
        expect((await polling).status).toBe("completed");
        expect(vi.getTimerCount()).toBe(0);
        expect(getRender).toHaveBeenCalledTimes(2);
      } finally {
        await vi.runAllTimersAsync();
        await polling;
        vi.useRealTimers();
      }
    });

    it("aborts when the AbortSignal is fired", async () => {
      const client = stubClient([makeDetail({ status: "queued" })]);
      const controller = new AbortController();
      controller.abort(new Error("user cancelled"));
      await expect(
        pollUntilTerminal(client, "hfr_test", { signal: controller.signal }),
      ).rejects.toThrow("user cancelled");
    });
  });
});
