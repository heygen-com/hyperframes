import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeTimelineLike } from "./types";
import { AFTER_FONTS_SCRIPT_TYPE } from "../compiler/scriptRuns";

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
    main: {
      play() {},
      pause() {},
      seek() {},
      time: () => 0,
      duration,
    } as unknown as RuntimeTimelineLike,
  };
}

describe("runtime start-up failure", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.doUnmock("./init");
    vi.doUnmock("./clipTree");
    vi.doUnmock("./timeline");
    vi.doUnmock("../compiler/svgSelectorAliases");
    vi.doUnmock("./afterFonts");
    document.body.innerHTML = "";
    window.__timelines = {};
    delete window.__renderReady;
    delete window.__hfStartupError;
    delete window.__hfTimelinesBuilding;
    window.__hfRuntimeTeardown?.();
    delete (window as { __hyperframeRuntimeBootstrapped?: boolean })
      .__hyperframeRuntimeBootstrapped;
  });

  it("records a named error when the step before runtime start-up throws", async () => {
    vi.doMock("../compiler/svgSelectorAliases", () => ({
      refreshSvgSelectorAliases: () => {
        throw new Error("aliases");
      },
    }));

    await expect(evaluateRuntime()).rejects.toThrow("aliases");
    expect(window.__hfStartupError).toContain("HyperFrames runtime failed: Error: aliases");
  });

  it("records a named error when running the font-gated scripts fails", async () => {
    document.body.innerHTML = `<script type="${AFTER_FONTS_SCRIPT_TYPE}"></script>`;
    const failed = Promise.reject(new Error("after fonts"));
    failed.catch(() => {});
    vi.doMock("./afterFonts", () => ({ runScriptsAfterFonts: () => failed }));
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);

    await evaluateRuntime();
    await vi.waitFor(() =>
      expect(window.__hfStartupError).toContain("HyperFrames runtime failed: Error: after fonts"),
    );
    expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ message: "after fonts" }));
  });

  it("records a named start-up error when runtime start-up throws", async () => {
    vi.doMock("./init", async (importOriginal) => ({
      ...(await importOriginal<typeof import("./init")>()),
      initSandboxRuntimeModular: () => {
        throw new TypeError("boom");
      },
    }));

    await expect(evaluateRuntime()).rejects.toThrow("boom");
    expect(window.__hfStartupError).toContain("HyperFrames runtime failed: TypeError: boom");
    expect(window.__hfStartupError).toContain(
      "Check the composition's scripts and window.__timelines",
    );
  });

  it("still records the failure when the thrown value cannot be printed", async () => {
    const thrown: unknown = Object.create(null);
    vi.doMock("./init", async (importOriginal) => ({
      ...(await importOriginal<typeof import("./init")>()),
      initSandboxRuntimeModular: () => {
        throw thrown;
      },
    }));

    await expect(evaluateRuntime()).rejects.toBe(thrown);
    expect(window.__hfStartupError).toContain("HyperFrames runtime failed: unknown error.");
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
    expect(window.__hfStartupError).toContain("HyperFrames runtime failed: Error: clip tree");
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
    expect(window.__hfStartupError).toContain(
      "HyperFrames runtime failed: Error: late timeline post",
    );
  });

  it("keeps a start-up error after a later timeline post succeeds", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("CSS", { escape: (value: string) => value });
    mountRoot();
    let posts = 0;
    vi.doMock("./timeline", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./timeline")>();
      return {
        ...actual,
        collectRuntimeTimelinePayload: (
          ...args: Parameters<typeof actual.collectRuntimeTimelinePayload>
        ) => {
          posts += 1;
          if (posts === 2) throw new Error("end of start-up");
          return actual.collectRuntimeTimelinePayload(...args);
        },
      };
    });

    await expect(evaluateRuntime()).rejects.toThrow("end of start-up");
    vi.advanceTimersByTime(1);

    expect(posts).toBeGreaterThan(2);
    expect(window.__hfStartupError).toContain("HyperFrames runtime failed: Error: end of start-up");
  });
});
