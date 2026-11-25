import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EscapedRejectionError } from "./services/renderOrchestrator.js";
import { onEscapedRejection, runInRenderScope } from "./server.js";

const testLog = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });
type RejectionListener = (reason: unknown, promise: Promise<unknown>) => void;

describe("a rejection nobody handled during a render", () => {
  const log = testLog();
  let runnerListeners: RejectionListener[] = [];
  const handler: RejectionListener = (reason) => onEscapedRejection(reason, log);
  beforeEach(() => {
    // Stand in for the server: only its handler hears rejections during the test.
    runnerListeners = process.listeners("unhandledRejection");
    process.removeAllListeners("unhandledRejection");
    process.on("unhandledRejection", handler);
  });
  afterEach(() => {
    process.off("unhandledRejection", handler);
    for (const listener of runnerListeners) process.on("unhandledRejection", listener);
  });

  // A render that runs until it is aborted or told to finish, like the pipeline does.
  const render = (requestId: string, finish: Promise<void>, leak = false) =>
    runInRenderScope(requestId, new AbortController(), async (signal) => {
      await new Promise((r) => setTimeout(r, 0));
      // Work this render started, whose failure nobody handles.
      if (leak) void Promise.reject(new Error("lost blend"));
      await Promise.race([
        finish,
        new Promise<never>((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason)),
        ),
      ]);
      return requestId;
    });

  it("fails only the render it came from, with its own error, and logs that render", async () => {
    let finishOther = () => {};
    const other = render("req-2", new Promise<void>((r) => (finishOther = r)));
    const leaking = render("req-1", new Promise<void>(() => {}), true);

    const failure = await leaking.catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(EscapedRejectionError);
    expect(failure).toMatchObject({ message: "lost blend" });
    expect(log.error).toHaveBeenCalledWith(
      "Unhandled promise rejection",
      expect.objectContaining({ requestId: "req-1", error: "lost blend" }),
    );

    finishOther();
    await expect(other).resolves.toBe("req-2");
  });

  it("outside any render is logged and does not throw", () => {
    expect(() => onEscapedRejection("stray", log)).not.toThrow();
    expect(log.error).toHaveBeenCalledWith(
      "Unhandled promise rejection",
      expect.objectContaining({ requestId: null, error: "stray" }),
    );
  });
});
