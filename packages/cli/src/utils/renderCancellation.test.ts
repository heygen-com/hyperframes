// fallow-ignore-file code-duplication
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRenderCancellationScope } from "./renderCancellation.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("createRenderCancellationScope ancestor monitoring", () => {
  it.each([
    { label: "dead", identity: "windows:birth", alive: false },
    { label: "identity-less", identity: null, alive: true },
  ])("stops capture before retaining a $label parent PID", ({ identity, alive }) => {
    const lookupIdentity = vi.fn(() => identity);
    const isAlive = vi.fn(() => alive);
    const cancellation = createRenderCancellationScope({
      signalTarget: { on: vi.fn(), off: vi.fn() },
      pid: 100,
      parentPid: (pid) => (pid === 100 ? 50 : 1),
      identity: lookupIdentity,
      isAlive,
    });

    cancellation.checkAncestors();

    expect(cancellation.signal.aborted).toBe(false);
    expect(isAlive).toHaveBeenCalledTimes(1);
    expect(lookupIdentity).toHaveBeenCalledTimes(alive ? 1 : 0);
    cancellation.dispose();
  });

  it("keeps termination handlers installed until cancellation cleanup finishes", () => {
    const handlers = new Map<string, () => void>();
    const signalTarget = {
      on: vi.fn((signal: string, handler: () => void) => handlers.set(signal, handler)),
      off: vi.fn((signal: string) => handlers.delete(signal)),
    };
    const cancellation = createRenderCancellationScope({
      signalTarget,
      pid: 100,
      parentPid: () => 1,
    });

    handlers.get("SIGTERM")?.();
    handlers.get("SIGTERM")?.();

    expect(cancellation.signal.aborted).toBe(true);
    expect(handlers.has("SIGTERM")).toBe(true);
    cancellation.dispose();
    expect(handlers.size).toBe(0);
  });

  it("does not treat repeated identity lookup failures as proof an ancestor exited", () => {
    vi.useFakeTimers();
    let identity: string | null = "ancestor-birth-token";
    const cancellation = createRenderCancellationScope({
      signalTarget: { on: vi.fn(), off: vi.fn() },
      pid: 100,
      parentPid: (pid) => (pid === 100 ? 50 : 1),
      identity: () => identity,
      isAlive: () => true,
      parentPollIntervalMs: 10,
    });

    identity = null;
    vi.advanceTimersByTime(100);

    expect(cancellation.signal.aborted).toBe(false);
    cancellation.dispose();
  });

  it("aborts through the win32-compatible seam when the kernel proves the ancestor is gone", () => {
    vi.useFakeTimers();
    let identity: string | null = "ancestor-birth-token";
    let alive = true;
    const cancellation = createRenderCancellationScope({
      signalTarget: { on: vi.fn(), off: vi.fn() },
      pid: 100,
      parentPid: (pid) => (pid === 100 ? 50 : 1),
      identity: () => (identity === null ? null : `windows:${identity}`),
      isAlive: () => alive,
      parentPollIntervalMs: 10,
    });

    identity = null;
    alive = false;
    vi.advanceTimersByTime(10);

    expect(cancellation.signal.aborted).toBe(true);
    expect(cancellation.signal.reason).toMatchObject({
      message: "render_cancelled_parent_exited",
    });
    cancellation.dispose();
  });

  it("aborts when a live PID has a different birth identity", () => {
    let identity = "ancestor-birth-token";
    const cancellation = createRenderCancellationScope({
      signalTarget: { on: vi.fn(), off: vi.fn() },
      platform: "linux",
      pid: 100,
      parentPid: (pid) => (pid === 100 ? 50 : 1),
      identity: () => identity,
      isAlive: () => true,
    });

    identity = "reused-pid-birth-token";
    cancellation.checkAncestors();

    expect(cancellation.signal.aborted).toBe(true);
    cancellation.dispose();
  });

  it("takes the off-Linux process snapshot once and never from a checkpoint", () => {
    vi.useFakeTimers();
    const ancestorSnapshot = vi.fn(() => [{ pid: 50, identity: "windows:ancestor-birth-token" }]);
    const isAlive = vi.fn(() => true);
    const cancellation = createRenderCancellationScope({
      signalTarget: { on: vi.fn(), off: vi.fn() },
      platform: "win32",
      pid: 100,
      ancestorSnapshot,
      isAlive,
    });

    expect(ancestorSnapshot).toHaveBeenCalledExactlyOnceWith(100);
    vi.advanceTimersByTime(1_999);
    vi.advanceTimersByTime(1);
    expect(isAlive).toHaveBeenCalledOnce();
    cancellation.checkAncestors();
    cancellation.checkAncestors();
    expect(ancestorSnapshot).toHaveBeenCalledOnce();
    expect(isAlive).toHaveBeenCalledTimes(3);
    cancellation.dispose();
  });

  it("leaves SIGHUP ignored and parent ownership untracked for detached renders", () => {
    const handlers = new Map<string, () => void>();
    const parentPid = vi.fn(() => 50);
    const previous = process.env.HYPERFRAMES_RENDER_DETACHED;
    process.env.HYPERFRAMES_RENDER_DETACHED = "1";
    try {
      const cancellation = createRenderCancellationScope({
        signalTarget: {
          on: vi.fn((signal: string, handler: () => void) => handlers.set(signal, handler)),
          off: vi.fn((signal: string) => handlers.delete(signal)),
        },
        parentPid,
      });

      expect([...handlers.keys()]).toEqual(["SIGINT", "SIGTERM"]);
      expect(parentPid).not.toHaveBeenCalled();
      cancellation.checkAncestors();
      expect(cancellation.signal.aborted).toBe(false);
      cancellation.dispose();
    } finally {
      if (previous === undefined) delete process.env.HYPERFRAMES_RENDER_DETACHED;
      else process.env.HYPERFRAMES_RENDER_DETACHED = previous;
    }
  });
});
