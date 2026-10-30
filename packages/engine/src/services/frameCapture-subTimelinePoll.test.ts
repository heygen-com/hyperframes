/**
 * pollSubCompositionTimelines fail-fast contract: a script resource that
 * failed to load can never register its `window.__timelines[id]`, so the
 * poll must cut to the short grace window instead of burning the full
 * playerReadyTimeout (measured wild: a 705-render spike at the 45s setup
 * bucket over 30 days — ~1% of local renders).
 */

import { describe, expect, it, vi } from "vitest";
import type { Page } from "puppeteer-core";
import { parseHTML } from "linkedom";
import { AUTHORED_SOURCE_BEGIN, AUTHORED_SOURCE_END } from "@hyperframes/core";
import { authorScriptsMayRegisterTimelines, pollSubCompositionTimelines } from "./frameCapture.js";

// A function argument is the author-script scan; these tests model pages whose scripts may register.
function makeMockPage(evaluateResults: (expr: string) => unknown): Page {
  return {
    evaluate: vi.fn(async (expr: string | (() => unknown)) =>
      typeof expr === "function" ? true : evaluateResults(expr),
    ),
  } as unknown as Page;
}

describe("pollSubCompositionTimelines fail-fast", () => {
  it("returns ready and forces a timeline rebind when timelines register", async () => {
    const page = makeMockPage(() => true);
    const outcome = await pollSubCompositionTimelines(page, 1_000, { intervalMs: 10 });
    expect(outcome).toBe("ready");
    // Second evaluate is the __hfForceTimelineRebind call.
    expect((page.evaluate as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  it("bails after the grace window when a script resource failed to load", async () => {
    const page = makeMockPage((expr) =>
      expr.includes("__hfForceTimelineRebind") ? undefined : false,
    );
    const started = Date.now();
    const outcome = await pollSubCompositionTimelines(
      page,
      60_000, // full timeout must NOT be waited
      {
        intervalMs: 10,
        getScriptLoadFailures: () => ["http://localhost/animations.js"],
        scriptFailureGraceMs: 50,
      },
    );
    expect(outcome).toBe("script_failure");
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("stops at once when the caller says so, without waiting out the timeout", async () => {
    const page = makeMockPage((expr) =>
      expr.includes("__hfForceTimelineRebind") ? undefined : false,
    );
    const shouldStop = vi.fn(() => true);
    const outcome = await pollSubCompositionTimelines(page, 60_000, {
      intervalMs: 10,
      getScriptLoadFailures: () => [],
      shouldStop,
    });
    expect(outcome).toBe("timeout");
    expect(shouldStop).toHaveBeenCalledTimes(1);
  });

  it("waits the full timeout when timelines are missing but no script failed", async () => {
    const page = makeMockPage(() => false);
    const outcome = await pollSubCompositionTimelines(page, 120, {
      intervalMs: 10,
      getScriptLoadFailures: () => [],
    });
    expect(outcome).toBe("timeout");
  });

  it("keeps waiting through the grace window when failures appear but timelines register late", async () => {
    let calls = 0;
    const page = makeMockPage((expr) => {
      if (expr.includes("__hfForceTimelineRebind")) return undefined;
      calls++;
      return calls >= 3; // registers on the 3rd poll tick, inside the grace window
    });
    const outcome = await pollSubCompositionTimelines(page, 60_000, {
      intervalMs: 10,
      getScriptLoadFailures: () => ["http://localhost/late.js"],
      scriptFailureGraceMs: 10_000, // generous grace — registration lands first
    });
    expect(outcome).toBe("ready");
  });

  it("bails after the error grace when a script threw and no timeline registers", async () => {
    const page = makeMockPage((expr) =>
      expr.includes("__hfForceTimelineRebind") ? undefined : false,
    );
    const started = Date.now();
    const outcome = await pollSubCompositionTimelines(page, 60_000, {
      intervalMs: 10,
      getScriptLoadFailures: () => [],
      getPageErrors: () => ["TypeError: Cannot read properties of null"],
      scriptErrorGraceMs: 50,
    });
    expect(outcome).toBe("script_failure");
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("counts the error grace from the first error, not from the start of the wait", async () => {
    const started = Date.now();
    const errors: string[] = [];
    const page = makeMockPage((expr) => {
      if (expr.includes("__hfForceTimelineRebind")) return undefined;
      if (Date.now() - started > 100 && errors.length === 0) errors.push("TypeError: late");
      return false;
    });
    await pollSubCompositionTimelines(page, 60_000, {
      intervalMs: 10,
      getPageErrors: () => errors,
      scriptErrorGraceMs: 150,
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
  });

  it("still takes a late registration after a page error inside the grace", async () => {
    let calls = 0;
    const page = makeMockPage((expr) => {
      if (expr.includes("__hfForceTimelineRebind")) return undefined;
      calls++;
      return calls >= 3;
    });
    const outcome = await pollSubCompositionTimelines(page, 60_000, {
      intervalMs: 10,
      getPageErrors: () => ["ReferenceError: chrome is not defined"],
      scriptErrorGraceMs: 10_000,
    });
    expect(outcome).toBe("ready");
  });
});

describe("pollSubCompositionTimelines when no author script can register a timeline", () => {
  it("is ready at once instead of waiting out the timeout", async () => {
    const evaluate = vi.fn(async (expr: string | (() => unknown)) =>
      typeof expr === "function"
        ? false
        : expr.includes("__hfForceTimelineRebind")
          ? undefined
          : false,
    );
    const started = Date.now();
    const outcome = await pollSubCompositionTimelines({ evaluate } as unknown as Page, 60_000, {
      intervalMs: 10,
      getScriptLoadFailures: () => [],
    });
    expect(outcome).toBe("ready");
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe("pollSubCompositionTimelines when a script failed on a page nothing can register on", () => {
  it("keeps the wait, so the failure is named instead of the page passing as ready", async () => {
    const evaluate = vi.fn(async (expr: string | (() => unknown)) =>
      typeof expr === "function"
        ? false
        : expr.includes("__hfForceTimelineRebind")
          ? undefined
          : false,
    );
    const outcome = await pollSubCompositionTimelines({ evaluate } as unknown as Page, 60_000, {
      intervalMs: 10,
      getScriptLoadFailures: () => [],
      getPageErrors: () => ["TypeError: x"],
      scriptErrorGraceMs: 50,
    });
    expect(outcome).toBe("script_failure");
  });
});

describe("authorScriptsMayRegisterTimelines", () => {
  const RUNTIME_ATTR = "data-hyperframes-preview-runtime";

  async function scan(html: string, files: Record<string, string> = {}): Promise<boolean> {
    const { document } = parseHTML(html);
    Object.defineProperty(document, "readyState", { value: "complete" });
    vi.stubGlobal("document", document);
    vi.stubGlobal("location", new URL("http://localhost:3000/index.html"));
    vi.stubGlobal("fetch", async (url: URL) => ({
      text: async () => {
        const body = files[url.pathname];
        if (body === undefined) throw new Error("404");
        return body;
      },
    }));
    try {
      return await authorScriptsMayRegisterTimelines(
        RUNTIME_ATTR,
        AUTHORED_SOURCE_BEGIN,
        AUTHORED_SOURCE_END,
      );
    } finally {
      delete (globalThis as { __hfAuthorScan?: boolean }).__hfAuthorScan;
      vi.unstubAllGlobals();
    }
  }

  it("is false for scripts that never mention a timeline registration", async () => {
    expect(
      await scan(
        `<body><script>draw()</script><template><script>animate()</script></template></body>`,
      ),
    ).toBe(false);
  });

  it("reads only the authored part of a scoped wrapper, which mentions __timelines itself", async () => {
    const wrapped = (source: string) =>
      `<body><script>(function(){ window.__timelines = window.__timelines || {};\n${AUTHORED_SOURCE_BEGIN}\n${source}\n${AUTHORED_SOURCE_END}\n})();</script></body>`;
    expect(await scan(wrapped("draw()"))).toBe(false);
    expect(await scan(wrapped("window.__timelines['a'] = tl"))).toBe(true);
  });

  it("ignores the runtime, which mentions __timelines itself", async () => {
    expect(
      await scan(`<body><script ${RUNTIME_ATTR}>window.__timelines = {}</script></body>`),
    ).toBe(false);
  });

  it("is true when an inline script or a template script registers one", async () => {
    expect(await scan(`<body><script>window.__timelines["a"] = tl</script></body>`)).toBe(true);
    expect(
      await scan(`<body><template><script>window.__timelines.b = tl</script></template></body>`),
    ).toBe(true);
  });

  it("answers true for a module script or any code that imports another file", async () => {
    expect(await scan(`<body><script type="module">draw()</script></body>`)).toBe(true);
    expect(await scan(`<body><script>import("./scene.js").then(run)</script></body>`)).toBe(true);
    expect(
      await scan(`<body><script src="/a.js"></script></body>`, {
        "/a.js": 'import { x } from "./b.js"',
      }),
    ).toBe(true);
    expect(await scan(`<body><script>const important = 1; draw(important)</script></body>`)).toBe(
      false,
    );
  });

  it("reads same-origin scripts and answers true for ones it cannot read", async () => {
    expect(await scan(`<body><script src="/a.js"></script></body>`, { "/a.js": "draw()" })).toBe(
      false,
    );
    expect(
      await scan(`<body><script src="/a.js"></script></body>`, {
        "/a.js": "window.__timelines.x = 1",
      }),
    ).toBe(true);
    expect(await scan(`<body><script src="/missing.js"></script></body>`)).toBe(true);
    expect(await scan(`<body><script src="https://cdn.example.com/lib.js"></script></body>`)).toBe(
      true,
    );
  });
});
