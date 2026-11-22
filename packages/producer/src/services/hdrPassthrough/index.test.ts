import { describe, expect, it } from "bun:test";
import { attemptHdrPassthrough, createLazyOverlaySession } from "./index.js";
import type { HdrPassthroughInput } from "./types.js";

interface LogCall {
  level: "info" | "warn";
  message: string;
}

function fakeInput(abortSignal?: AbortSignal): { input: HdrPassthroughInput; calls: LogCall[] } {
  const calls: LogCall[] = [];
  const log = {
    info: (message: string) => calls.push({ level: "info", message }),
    warn: (message: string) => calls.push({ level: "warn", message }),
    error: () => {},
    debug: () => {},
  };
  // Only the fields the fallback path touches; anything else would throw if read.
  const input = {
    log,
    abortSignal,
    assertNotAborted: () => abortSignal?.throwIfAborted(),
  } as unknown as HdrPassthroughInput;
  return { input, calls };
}

describe("attemptHdrPassthrough", () => {
  it("falls back with a warning when a stage throws", async () => {
    const { input, calls } = fakeInput();
    const outcome = await attemptHdrPassthrough(input);
    expect(outcome.kind).toBe("fallback");
    if (outcome.kind !== "fallback") throw new Error("unreachable");
    expect(outcome.reason).toBe("error");
    expect(calls.some((c) => c.level === "warn" && c.message.includes("falling back"))).toBe(true);
  });

  it("rethrows instead of falling back once the render is aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    const { input } = fakeInput(controller.signal);
    await expect(attemptHdrPassthrough(input)).rejects.toThrow();
  });
});

describe("createLazyOverlaySession", () => {
  it("opens nothing until get() and closes as a no-op", async () => {
    const { input } = fakeInput();
    const session = createLazyOverlaySession(input);
    expect(session.opened).toBe(false);
    await session.close();
    expect(session.opened).toBe(false);
  });
});
