import { describe, expect, it } from "bun:test";
import type { CaptureSession } from "@hyperframes/engine";
import {
  attemptHdrPassthrough,
  createLazyOverlaySession,
  type OverlaySessionDeps,
} from "./index.js";
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

describe("createLazyOverlaySession close", () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }
  const fakeSession = { page: {} } as unknown as CaptureSession;

  it("closes a session whose open was still in flight when close() ran", async () => {
    const { input } = fakeInput();
    const open = deferred<CaptureSession>();
    const closed: CaptureSession[] = [];
    const deps: OverlaySessionDeps = {
      open: () => open.promise,
      close: async (s) => {
        closed.push(s);
      },
    };
    const session = createLazyOverlaySession(input, deps);
    const opening = session.get();
    const closing = session.close();
    open.resolve(fakeSession);
    await opening;
    await closing;
    expect(closed).toEqual([fakeSession]);
    // Idempotent, and nothing reopens after close.
    await session.close();
    expect(closed).toEqual([fakeSession]);
    await expect(session.get()).rejects.toThrow("closed");
  });

  it("closes nothing when the open failed (the open cleans up after itself)", async () => {
    const { input } = fakeInput();
    const open = deferred<CaptureSession>();
    let closes = 0;
    const session = createLazyOverlaySession(input, {
      open: () => open.promise,
      close: async () => {
        closes++;
      },
    });
    const opening = session.get();
    const closing = session.close();
    open.reject(new Error("browser failed to launch"));
    await expect(opening).rejects.toThrow("browser failed to launch");
    await closing;
    expect(closes).toBe(0);
  });

  it("logs, and does not throw, when closing fails", async () => {
    const { input, calls } = fakeInput();
    const session = createLazyOverlaySession(input, {
      open: async () => fakeSession,
      close: async () => {
        throw new Error("target closed");
      },
    });
    await session.get();
    await session.close();
    expect(calls.some((c) => c.level === "warn" && c.message.includes("closing"))).toBe(true);
  });
});
