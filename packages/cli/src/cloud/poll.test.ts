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
