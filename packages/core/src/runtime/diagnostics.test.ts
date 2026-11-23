// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMPOSITION_SOURCE_URL } from "../compiler/scriptRuns";
import { recordStartupError, swallow } from "./diagnostics";

function errorWithStack(stack: unknown): Error {
  const error = new TypeError("bad stagger");
  Object.defineProperty(error, "stack", { value: stack, configurable: true });
  return error;
}

describe("recordStartupError", () => {
  const libraryFrames = [
    "at distribute (https://cdn.example/gsap.min.js:11:6130)",
    "at new Tween (https://cdn.example/gsap.min.js:11:28000)",
    "at Timeline.to (https://cdn.example/gsap.min.js:11:42000)",
    "at otherLibrary (https://cdn.example/other.js:2:3)",
  ];

  afterEach(() => {
    delete window.__hfStartupError;
    vi.restoreAllMocks();
  });

  it.each([
    COMPOSITION_SOURCE_URL,
    "https://preview.example/scenes/custom-intro.html",
    "file:///project/gsap-hyperframes-demo.htm",
    "https://preview.example/scenes/intro.html?revision=2",
  ])("keeps the top three frames and the first authored frame at %s", (location) => {
    const authored = `at makeScene (${location}:42:7)`;
    const later = `at laterScene (${location}:99:2)`;
    recordStartupError(
      errorWithStack(["TypeError: bad stagger", ...libraryFrames, authored, later].join("\n")),
    );

    expect(window.__hfStartupError).toContain(
      `TypeError: bad stagger [thrown at: ${[...libraryFrames.slice(0, 3), authored].join(" <- ")}]`,
    );
    expect(window.__hfStartupError).not.toContain(libraryFrames[3]);
    expect(window.__hfStartupError).not.toContain(later);
    expect(window.__hfStartupError).not.toMatch(/[\r\n]/);
    expect(window.__hfStartupError).toContain(
      "Check the composition's scripts and window.__timelines",
    );
  });

  it.each(["https://preview.example/", "https://preview.example/view?scene=intro"])(
    "recognizes the current extensionless document at %s",
    (url) => {
      vi.spyOn(document, "URL", "get").mockReturnValue(url);
      const authored = `at makeScene (${url}:20:4)`;
      recordStartupError(errorWithStack([...libraryFrames, authored].join("\n")));

      expect(window.__hfStartupError).toContain(authored);
      expect(window.__hfStartupError).not.toContain(libraryFrames[3]);
    },
  );

  it("does not duplicate an authored frame already among the first three", () => {
    const authored = `at makeScene (${COMPOSITION_SOURCE_URL}:42:7)`;
    recordStartupError(errorWithStack([authored, ...libraryFrames].join("\n")));

    expect(window.__hfStartupError?.split(authored)).toHaveLength(2);
    expect(window.__hfStartupError).toContain(
      `[thrown at: ${[authored, ...libraryFrames.slice(0, 2)].join(" <- ")}]`,
    );
  });

  it("limits a library-only stack and does not select injected runtime scripts", () => {
    recordStartupError(
      errorWithStack([...libraryFrames, "at boot (hyperframes://runtime.html:5:6)"].join("\n")),
    );

    expect(window.__hfStartupError).toContain(
      `[thrown at: ${libraryFrames.slice(0, 3).join(" <- ")}]`,
    );
    expect(window.__hfStartupError).not.toContain(libraryFrames[3]);
    expect(window.__hfStartupError).not.toContain("hyperframes://");
  });

  it("preserves headerless Firefox and Safari frames including the first frame", () => {
    const frames = [
      "distribute@https://cdn.example/gsap.min.js:11:6130",
      "Tween@https://cdn.example/gsap.min.js:11:28000",
      "to@https://cdn.example/gsap.min.js:11:42000",
      "other@https://cdn.example/other.js:2:3",
      `@${COMPOSITION_SOURCE_URL}:42:7`,
    ];
    recordStartupError(errorWithStack(frames.join("\r\n")));

    expect(window.__hfStartupError).toContain(
      `[thrown at: ${[...frames.slice(0, 3), frames[4]].join(" <- ")}]`,
    );
    expect(window.__hfStartupError).not.toContain(frames[3]);
    expect(window.__hfStartupError).not.toMatch(/[\r\n]/);
  });

  it("keeps author-provided source URLs and native frames in the leading frames", () => {
    const frames = ["at render (custom-scene.js:8:9)", "at Array.map (<anonymous>)"];
    recordStartupError(errorWithStack(["TypeError: bad stagger", ...frames].join("\n")));

    expect(window.__hfStartupError).toContain(`[thrown at: ${frames.join(" <- ")}]`);
  });

  it("normalizes a multiline message and frames without treating message lines as frames", () => {
    const error = new Error("scene\r\n  failed\tto build");
    error.stack = `Error: scene\r\n  failed\tto build\r\n\tat render   (${COMPOSITION_SOURCE_URL}:8:9)\r\n`;
    recordStartupError(error);

    expect(window.__hfStartupError).toContain(
      `Error: scene failed to build [thrown at: at render (${COMPOSITION_SOURCE_URL}:8:9)]`,
    );
    expect(window.__hfStartupError).not.toMatch(/[\r\n\t]/);
  });

  it("does not mistake an at-prefixed message continuation for a stack frame", () => {
    const error = new Error("scene failed\nat initialization");
    error.stack = `Error: scene failed\nat initialization\n    at render (${COMPOSITION_SOURCE_URL}:8:9)`;
    recordStartupError(error);

    expect(window.__hfStartupError).toContain(
      `Error: scene failed at initialization [thrown at: at render (${COMPOSITION_SOURCE_URL}:8:9)]`,
    );
  });

  it.each([undefined, null, "", "TypeError: bad stagger\nnot a stack frame", 42, {}])(
    "retains the useful error detail without a valid stack: %s",
    (stack) => {
      recordStartupError(errorWithStack(stack));
      expect(window.__hfStartupError).toContain(
        "HyperFrames runtime failed: TypeError: bad stagger.",
      );
      expect(window.__hfStartupError).not.toContain("[thrown at:");
    },
  );

  it("retains the useful name and message when the stack getter throws", () => {
    const error = new TypeError("bad stagger");
    Object.defineProperty(error, "stack", {
      get: () => {
        throw new Error("stack unavailable");
      },
    });
    recordStartupError(error);

    expect(window.__hfStartupError).toContain(
      "HyperFrames runtime failed: TypeError: bad stagger.",
    );
    expect(window.__hfStartupError).not.toContain("[thrown at:");
  });

  it("keeps non-Error values and the unprintable-value fallback", () => {
    recordStartupError("script failed");
    expect(window.__hfStartupError).toContain("HyperFrames runtime failed: script failed.");
    recordStartupError(Object.create(null));
    expect(window.__hfStartupError).toContain("HyperFrames runtime failed: unknown error.");
  });

  it("records an unknown error when checking a thrown value's prototype fails", () => {
    const thrown = new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw new Error("prototype unavailable");
        },
      },
    );
    expect(() => recordStartupError(thrown)).not.toThrow();
    expect(window.__hfStartupError).toContain("HyperFrames runtime failed: unknown error.");
  });
});

interface HFTestWindow {
  __hfDebug?: boolean;
  __HYPERFRAMES_DEBUG?: boolean;
  __hf?: {
    onSwallowed?: (e: { label: string; error: unknown }) => void;
  };
}

describe("swallow", () => {
  const w = window as unknown as HFTestWindow;
  const originalDebug = console.debug;

  beforeEach(() => {
    delete w.__hfDebug;
    delete w.__HYPERFRAMES_DEBUG;
    delete w.__hf;
    console.debug = vi.fn();
  });

  afterEach(() => {
    console.debug = originalDebug;
    delete w.__hfDebug;
    delete w.__HYPERFRAMES_DEBUG;
    delete w.__hf;
  });

  it("is silent by default — no console output, no handler call", () => {
    swallow("test.silent", new Error("boom"));
    expect(console.debug).not.toHaveBeenCalled();
  });

  it("logs to console.debug when window.__hfDebug is true", () => {
    w.__hfDebug = true;
    const err = new Error("boom");
    swallow("test.debug", err);
    expect(console.debug).toHaveBeenCalledWith("[hyperframes] test.debug swallowed:", err);
  });

  it("also honors window.__HYPERFRAMES_DEBUG (legacy flag)", () => {
    w.__HYPERFRAMES_DEBUG = true;
    swallow("test.legacy", "string-error");
    expect(console.debug).toHaveBeenCalledWith(
      "[hyperframes] test.legacy swallowed:",
      "string-error",
    );
  });

  it("dispatches to window.__hf.onSwallowed when installed", () => {
    const handler = vi.fn();
    w.__hf = { onSwallowed: handler };
    const err = new Error("from handler");
    swallow("test.handler", err);
    expect(handler).toHaveBeenCalledWith({ label: "test.handler", error: err });
  });

  it("does not propagate errors from the user-installed handler", () => {
    w.__hf = {
      onSwallowed: () => {
        throw new Error("handler exploded");
      },
    };
    expect(() => swallow("test.handler-throws", new Error("real"))).not.toThrow();
  });

  it("can run with both handler AND debug flag set", () => {
    w.__hfDebug = true;
    const handler = vi.fn();
    w.__hf = { onSwallowed: handler };
    swallow("test.both", "err");
    expect(handler).toHaveBeenCalled();
    expect(console.debug).toHaveBeenCalled();
  });
});
