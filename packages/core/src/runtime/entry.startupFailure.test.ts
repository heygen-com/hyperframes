import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeTimelineLike } from "./types";

// Its own file: a start-up that throws never installs its teardown, so what it started would leak into later tests.
async function evaluateRuntime(): Promise<void> {
  vi.resetModules();
  await import("./entry");
}

function mountRoot(): void {
  document.body.innerHTML = `<div data-composition-id="main" data-root="true" data-start="0"
    data-width="1920" data-height="1080"></div>`;
  const duration = () => 10;
  window.__timelines = {
    main: { play() {}, pause() {}, seek() {}, time: () => 0, duration } as unknown as RuntimeTimelineLike,
  };
}

describe("runtime start-up failure", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.doUnmock("./init");
    vi.doUnmock("./clipTree");
    vi.doUnmock("./timeline");
    document.body.innerHTML = "";
    window.__timelines = {};
    delete window.__renderReady;
    delete window.__hfStartupError;
    delete window.__hfTimelinesBuilding;
    window.__hfRuntimeTeardown?.();
    delete (window as { __hyperframeRuntimeBootstrapped?: boolean }).__hyperframeRuntimeBootstrapped;
  });

  it("records a named start-up error when runtime start-up throws", async () => {
    vi.doMock("./init", async (importOriginal) => ({
      ...(await importOriginal<typeof import("./init")>()),
      initSandboxRuntimeModular: () => {
        throw new TypeError("boom");
      },
    }));

    await expect(evaluateRuntime()).rejects.toThrow("boom");
    expect(window.__hfStartupError).toBe("HyperFrames runtime failed to start: TypeError: boom");
  });

  it("is not marked render-ready when posting the timeline throws", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("CSS", { escape: (value: string) => value });
    mountRoot();
    vi.doMock("./clipTree", async (importOriginal) => ({
      ...(await importOriginal<typeof import("./clipTree")>()),
      createClipTree: () => {
        throw new Error("clip tree");
      },
    }));

    await expect(evaluateRuntime()).rejects.toThrow("clip tree");
    expect(window.__renderReady).not.toBe(true);
    expect(window.__hfStartupError).toBe("HyperFrames runtime failed to start: Error: clip tree");
  });

  it("names the error when a timeline post after start-up throws", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("CSS", { escape: (value: string) => value });
    mountRoot();
    let failPosts = false;
    vi.doMock("./timeline", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./timeline")>();
      return {
        ...actual,
        collectRuntimeTimelinePayload: (
          ...args: Parameters<typeof actual.collectRuntimeTimelinePayload>
        ) => {
          if (failPosts) throw new Error("late timeline post");
          return actual.collectRuntimeTimelinePayload(...args);
        },
      };
    });

    await evaluateRuntime();
    expect(window.__renderReady).toBe(true);
    expect(window.__hfStartupError).toBeUndefined();
    failPosts = true;

    expect(() => vi.advanceTimersByTime(1)).toThrow("late timeline post");
    expect(window.__renderReady).not.toBe(true);
    expect(window.__hfStartupError).toBe(
      "HyperFrames runtime failed to start: Error: late timeline post",
    );
  });
});
