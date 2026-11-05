import { describe, expect, it, vi } from "vitest";
import {
  removeTreeBestEffort,
  removeTreeBestEffortAsync,
  removeTreeWithRetry,
  removeTreeWithRetryAsync,
} from "./removeTree.js";

const busy = () => Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
const retrying = expect.objectContaining({
  recursive: true,
  force: true,
  maxRetries: expect.any(Number),
});

describe("removeTree", () => {
  it("asks for retries so a lock that clears in a moment does not fail the removal", () => {
    const remove = vi.fn();
    removeTreeWithRetry("/p", remove);
    expect(remove).toHaveBeenCalledWith("/p", retrying);
    const options = remove.mock.calls[0]![1];
    expect(options.maxRetries).toBeGreaterThan(3);
    expect(options.retryDelay).toBeGreaterThan(0);
  });

  it("still throws when a removal the caller needs keeps failing", async () => {
    expect(() =>
      removeTreeWithRetry("/p", () => {
        throw busy();
      }),
    ).toThrow("EBUSY");
    await expect(removeTreeWithRetryAsync("/p", () => Promise.reject(busy()))).rejects.toThrow(
      "EBUSY",
    );
  });

  it("warns and returns when cleanup of finished work is refused", async () => {
    const warn = vi.fn();
    expect(() =>
      removeTreeBestEffort("/profile", {
        remove: () => {
          throw busy();
        },
        warn,
      }),
    ).not.toThrow();
    await removeTreeBestEffortAsync("/profile", { remove: () => Promise.reject(busy()), warn });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0]![0]).toContain("/profile");
    expect(warn.mock.calls[0]![0]).toContain("EBUSY");
  });

  it("stays quiet when the removal works", async () => {
    const warn = vi.fn();
    removeTreeBestEffort("/p", { remove: () => {}, warn });
    await removeTreeBestEffortAsync("/p", { remove: async () => {}, warn });
    expect(warn).not.toHaveBeenCalled();
  });
});
