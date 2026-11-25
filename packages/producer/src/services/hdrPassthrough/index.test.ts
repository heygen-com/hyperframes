import { describe, expect, it } from "bun:test";
import {
  type CaptureOptions,
  type CaptureSession,
  createReferenceBackgroundRecorder,
} from "@hyperframes/engine";
import {
  attemptHdrPassthrough,
  createLazyOverlaySession,
  type OverlaySessionDeps,
  type PassthroughDeps,
} from "./index.js";
import { EncoderPacingError } from "./encoderPacing.js";
import { BrowserClockError } from "./overlayFingerprint.js";
import type { HdrPassthroughInput, HdrPassthroughResult, PassthroughEligibility } from "./types.js";

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

describe("attemptHdrPassthrough pages", () => {
  type Opened = {
    n: number;
    record: CaptureOptions["recordReferenceBackground"];
    role?: string;
  };

  function harness(options: { analysisRan?: string; runFails?: boolean; runThrows?: Error } = {}) {
    const events: string[] = [];
    const opened: Opened[] = [];
    const backgrounds: unknown[] = [];
    const recorder = createReferenceBackgroundRecorder((result) => backgrounds.push(result));
    const { input, calls } = fakeInput();
    Object.assign(input, {
      job: {},
      buildCaptureOptions: () => ({ recordReferenceBackground: recorder }),
    });
    let analysisPage: CaptureSession | undefined;
    let capturePage: CaptureSession | undefined;
    const deps: PassthroughDeps = {
      sessions: {
        open: async (_input, record, role) => {
          const n = opened.length + 1;
          opened.push({ n, record, role });
          events.push(`open ${n}`);
          return { page: { n } } as unknown as CaptureSession;
        },
        close: async (session) => {
          events.push(`close ${(session.page as unknown as { n: number }).n}`);
        },
      },
      checkEligibility: async ({ session }) => {
        analysisPage = await session.get();
        events.push("eligibility");
        return { eligible: true } as unknown as PassthroughEligibility;
      },
      analysisPageCode: async (session) => {
        expect(session).toBe(analysisPage!);
        events.push("analysis page code");
        return options.analysisRan ?? null;
      },
      run: async (_input, _eligible, session) => {
        capturePage = await session.get();
        events.push("capture");
        // The capture page loads: its options' reader runs where the layered session's would.
        await opened.at(-1)?.record?.(async () => ({ kind: "solid", rgb: [1, 2, 3] }));
        if (options.runFails) throw new Error("overlay capture failed");
        if (options.runThrows) throw options.runThrows;
        return { warnings: [] } as unknown as HdrPassthroughResult;
      },
    };
    return {
      input,
      calls,
      deps,
      events,
      opened,
      backgrounds,
      recorder,
      pages: () => ({ analysisPage, capturePage }),
    };
  }

  it("captures on a fresh page, opened once the page eligibility seeked is closed", async () => {
    const h = harness();
    const outcome = await attemptHdrPassthrough(h.input, h.deps);
    expect(outcome.kind).toBe("completed");
    // The debugger watches the analysis page as it loads; the capture page is never paused.
    expect(h.opened.map((page) => page.role)).toEqual(["analysis", "capture"]);
    const { analysisPage, capturePage } = h.pages();
    expect(capturePage).toBeDefined();
    expect(capturePage).not.toBe(analysisPage);
    expect(h.events).toEqual([
      "open 1",
      "eligibility",
      "analysis page code",
      "close 1",
      "open 2",
      "capture",
      "close 2",
    ]);
  });

  it("leaves the reference background read to the layered session until the passthrough completes", async () => {
    const h = harness();
    await attemptHdrPassthrough(h.input, h.deps);
    // The analysis page never reads it; the capture page's read is recorded on completion.
    expect(h.opened[0]!.record).toBeUndefined();
    expect(h.opened[1]!.record).toBeDefined();
    expect(h.opened[1]!.record).not.toBe(h.recorder);
    expect(h.backgrounds).toEqual([{ reference_background: { kind: "solid", rgb: [1, 2, 3] } }]);

    const failed = harness({ runFails: true });
    const outcome = await attemptHdrPassthrough(failed.input, failed.deps);
    expect(outcome.kind).toBe("fallback");
    // After a fallback the layered session still makes the read (and its seek), as with the flag off.
    expect(failed.recorder.started).toBe(false);
    expect(failed.backgrounds).toEqual([]);
  });

  it("declines when page code ran on the analysis page, and never opens a capture page", async () => {
    const h = harness({ analysisRan: "1 page function(s) ran after load, first f in page.js" });
    const outcome = await attemptHdrPassthrough(h.input, h.deps);
    expect(outcome).toMatchObject({ kind: "fallback", reason: "seek_callback" });
    expect(h.events).toEqual(["open 1", "eligibility", "analysis page code", "close 1"]);
  });

  it("declines with ffmpeg_unsupported when the encoder cannot be paced", async () => {
    const h = harness({
      runThrows: new EncoderPacingError("the encoder process started 1 process(es) of its own"),
    });
    const outcome = await attemptHdrPassthrough(h.input, h.deps);
    expect(outcome).toMatchObject({
      kind: "fallback",
      reason: "ffmpeg_unsupported",
      detail: "the encoder process started 1 process(es) of its own",
    });
    expect(
      h.calls.some((c) => c.message.startsWith("[Render] HDR passthrough off: ffmpeg_unsupported")),
    ).toBe(true);
  });

  it.each([
    ["overlay_unsupported", "scroll-behavior other than auto on <div#roll>"],
    [
      "overlay_non_gsap_animation",
      "running animation at a probe: CSSTransition(opacity) on <div#t>",
    ],
  ] as const)(
    "declines with %s when a probe finds motion on the browser's clock",
    async (reason, detail) => {
      const h = harness({ runThrows: new BrowserClockError(reason, detail) });
      const outcome = await attemptHdrPassthrough(h.input, h.deps);
      expect(outcome).toMatchObject({ kind: "fallback", reason, detail });
    },
  );
});
