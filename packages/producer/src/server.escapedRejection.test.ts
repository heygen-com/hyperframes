import { describe, expect, it, vi } from "vitest";
import { onEscapedRejection, runInRenderScope } from "./server.js";

const testLog = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });

describe("a rejection nobody handled during a render", () => {
  it("fails that render with its error and leaves other renders running", async () => {
    const log = testLog();
    const other = new AbortController();
    const lost = new Error("lost blend");
    const render = runInRenderScope(
      "req-1",
      new AbortController(),
      (signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("render_cancelled")));
          // Surfaces later, from work this render started.
          setTimeout(() => onEscapedRejection(lost, log), 0);
        }),
    );
    await expect(render).rejects.toBe(lost);
    expect(log.error).toHaveBeenCalledWith("Unhandled promise rejection", {
      requestId: "req-1",
      error: "lost blend",
    });
    expect(other.signal.aborted).toBe(false);
  });

  it("outside any render is logged and does not throw", () => {
    const log = testLog();
    expect(() => onEscapedRejection("stray", log)).not.toThrow();
    expect(log.error).toHaveBeenCalledWith("Unhandled promise rejection", {
      requestId: null,
      error: "stray",
    });
  });
});
