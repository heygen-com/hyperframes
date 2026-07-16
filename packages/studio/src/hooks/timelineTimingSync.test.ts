// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "../player/store/playerStore";
import { jsonResponse, requestUrl } from "./fetchStubTestUtils";
import type { TimelineElement } from "../player/store/playerStore";
import {
  captureDurationRollback,
  finishClipTimingFallback,
  finishGroupTimingGsapFallback,
  readFileContent,
  shiftGsapPositions,
} from "./timelineTimingSync";

afterEach(() => {
  usePlayerStore.getState().reset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * Stub fetch: `/files/` reads return contents from the queue (repeating the
 * last entry), the GSAP-mutation endpoint owns the first/last contents as its
 * atomic before/after pair, and rollback succeeds conditionally.
 */
function stubFetch(
  fileContents: string[],
  gsapBody: unknown | Error,
  supportsOwnedMutations = true,
  gsapStatus = 200,
) {
  const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
    const url = requestUrl(input);
    if (url.includes("/gsap-mutation-capabilities")) {
      return supportsOwnedMutations
        ? jsonResponse({ atomicOwnershipPairs: true })
        : new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    }
    if (url.includes("/files/")) {
      return jsonResponse({ content: fileContents.at(-1) });
    }
    if (url.includes("/gsap-mutation-rollback/")) {
      return jsonResponse({ ok: true, restored: true, conflict: false });
    }
    if (url.includes("/gsap-mutations/")) {
      if (gsapBody instanceof Error) {
        return new Response(JSON.stringify({ error: gsapBody.message }), { status: 500 });
      }
      return new Response(JSON.stringify(gsapBody), {
        status: gsapStatus,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function clipFallbackInput(overrides: {
  reloadPreview: () => void;
  recordEdit: (edit: unknown) => Promise<void>;
}) {
  return {
    iframe: null,
    reloadPreview: overrides.reloadPreview,
    projectId: "p1",
    targetPath: "index.html",
    domId: "clip",
    label: "Move timeline clip",
    recordEdit: overrides.recordEdit as never,
    edit: { kind: "shift", delta: 1 } as const,
  };
}

describe("finishClipTimingFallback failure domains", () => {
  it("rolls back and skips preview sync when history recording fails", async () => {
    stubFetch(["<before>", "<before>", "<after>"], {
      mutated: true,
      scriptText: "tl.to()",
      before: "<before>",
      after: "<after>",
    });
    const reloadPreview = vi.fn();
    const foldError = new Error("history fold failed");
    const recordEdit = vi.fn(async () => {
      throw foldError;
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await finishClipTimingFallback(clipFallbackInput({ reloadPreview, recordEdit }));

    expect(recordEdit).toHaveBeenCalledTimes(1);
    expect(reloadPreview).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("GSAP"), foldError);
    const rollback = vi
      .mocked(fetch)
      .mock.calls.find(([input]) => requestUrl(input).includes("/gsap-mutation-rollback/"));
    expect(JSON.parse(String(rollback?.[1]?.body))).toEqual({
      expected: "<after>",
      restore: "<before>",
    });
  });

  it("reloads when the mutation endpoint fails after dispatch", async () => {
    stubFetch(["<before>"], new Error("mutation blew up"));
    const reloadPreview = vi.fn();
    const recordEdit = vi.fn(async () => {});
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await finishClipTimingFallback(clipFallbackInput({ reloadPreview, recordEdit }));

    expect(recordEdit).not.toHaveBeenCalled();
    expect(reloadPreview).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it("reloads when a successful response omits the exact ownership pair", async () => {
    stubFetch(["<possible-write>"], {});
    const reloadPreview = vi.fn();
    const recordEdit = vi.fn(async () => {});
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await finishClipTimingFallback(clipFallbackInput({ reloadPreview, recordEdit }));

    expect(recordEdit).not.toHaveBeenCalled();
    expect(reloadPreview).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("GSAP"),
      expect.objectContaining({ message: "Invalid owned GSAP mutation response" }),
    );
  });

  it("reloads when the mutation transport fails after dispatch", async () => {
    const transportError = new TypeError("connection reset");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: Parameters<typeof fetch>[0]) => {
        const url = requestUrl(input);
        if (url.includes("/gsap-mutation-capabilities")) {
          return jsonResponse({ atomicOwnershipPairs: true });
        }
        if (url.includes("/gsap-mutations/")) throw transportError;
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
    const reloadPreview = vi.fn();
    const recordEdit = vi.fn(async () => {});
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await finishClipTimingFallback(clipFallbackInput({ reloadPreview, recordEdit }));

    expect(recordEdit).not.toHaveBeenCalled();
    expect(reloadPreview).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("GSAP"),
      expect.objectContaining({ cause: transportError }),
    );
  });

  it("reloads the preview when the mutation endpoint reports an ownership conflict", async () => {
    stubFetch(
      ["<successor>"],
      { error: "file changed during GSAP mutation", conflict: true },
      true,
      409,
    );
    const reloadPreview = vi.fn();
    const recordEdit = vi.fn(async () => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await finishClipTimingFallback(clipFallbackInput({ reloadPreview, recordEdit }));

    expect(recordEdit).not.toHaveBeenCalled();
    expect(reloadPreview).toHaveBeenCalledTimes(1);
  });

  it("records the fold and syncs on the happy path", async () => {
    stubFetch(["<before>", "<before>", "<after>"], {
      mutated: true,
      scriptText: "tl.to()",
      before: "<before>",
      after: "<after>",
    });
    const reloadPreview = vi.fn();
    const recordEdit = vi.fn(async () => {});

    await finishClipTimingFallback(clipFallbackInput({ reloadPreview, recordEdit }));

    expect(recordEdit).toHaveBeenCalledTimes(1);
    expect(reloadPreview).toHaveBeenCalledTimes(1);
  });

  it("preflights ownership support before sending a mutation", async () => {
    const fetchMock = stubFetch(["<before>"], { mutated: true, scriptText: null }, false);
    const reloadPreview = vi.fn();
    const recordEdit = vi.fn(async () => {});
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await finishClipTimingFallback(clipFallbackInput({ reloadPreview, recordEdit }));

    expect(
      fetchMock.mock.calls.some(([input]) => requestUrl(input).includes("/gsap-mutations/")),
    ).toBe(false);
    expect(recordEdit).not.toHaveBeenCalled();
    expect(reloadPreview).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("GSAP"),
      expect.objectContaining({ message: "Server does not support owned GSAP mutations" }),
    );
  });

  it("reloads and surfaces a server that violates its advertised ownership contract", async () => {
    const fetchMock = stubFetch(["<after>"], { mutated: true, scriptText: null });
    const reloadPreview = vi.fn();
    const recordEdit = vi.fn(async () => {});
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await finishClipTimingFallback(clipFallbackInput({ reloadPreview, recordEdit }));

    expect(
      fetchMock.mock.calls.some(([input]) => requestUrl(input).includes("/gsap-mutations/")),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(([input]) =>
        requestUrl(input).includes("/gsap-mutation-rollback/"),
      ),
    ).toBe(false);
    expect(recordEdit).not.toHaveBeenCalled();
    expect(reloadPreview).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("GSAP"),
      expect.objectContaining({
        message: "Invalid owned GSAP mutation response",
      }),
    );
  });
});

describe("captureDurationRollback", () => {
  it("restores the pre-sync duration only when it changed", () => {
    usePlayerStore.getState().setDuration(4);
    const rollback = captureDurationRollback(null);

    // No change → rollback is a no-op (no spurious set).
    rollback();
    expect(usePlayerStore.getState().duration).toBe(4);

    usePlayerStore.getState().setDuration(9);
    rollback();
    expect(usePlayerStore.getState().duration).toBe(4);
  });
});

describe("fetch URL encoding (user-influenced segments)", () => {
  it("URI-encodes the projectId in file reads", async () => {
    const fetchMock = stubFetch(["<html>"], {});
    await readFileContent("p/../evil", "index.html");
    expect(requestUrl(fetchMock.mock.calls[0]![0])).toBe(
      "/api/projects/p%2F..%2Fevil/files/index.html",
    );
  });

  it("URI-encodes the projectId in GSAP mutation calls", async () => {
    const fetchMock = stubFetch([], {
      mutated: false,
      scriptText: null,
      before: "<html>",
      after: "<html>",
    });
    await shiftGsapPositions("p one", "scenes/intro.html", "clip", 1);
    expect(requestUrl(fetchMock.mock.calls[0]![0])).toBe(
      "/api/projects/p%20one/gsap-mutations/scenes%2Fintro.html",
    );
  });
});

/**
 * Live-preview iframe stub: inline GSAP script elements plus the runtime hooks
 * the timing rebind needs. `appendedScripts` records any script a sync path
 * executes — the rebind-only path must record NONE — and `scriptEls` lets tests
 * assert the original script elements were left untouched in the document.
 */
const LIVE_SCRIPT =
  'window.__timelines = window.__timelines || {}; window.__timelines["root"] = tl;';
const LIVE_CAPTION_SCRIPT =
  'window.__timelines = window.__timelines || {}; window.__timelines["captions"] = capTl;';

function buildLivePreviewIframe(liveScripts: string[] = [LIVE_SCRIPT]) {
  const scriptEls = liveScripts.map((text) => {
    const el = document.createElement("script");
    el.textContent = text;
    return el;
  });
  const container = document.createElement("div");
  for (const el of scriptEls) container.appendChild(el);

  const contentWindow = {
    gsap: { timeline: vi.fn(), set: vi.fn() },
    __hfForceTimelineRebind: vi.fn() as unknown,
    __timelines: { root: { kill: vi.fn() } } as Record<string, unknown>,
    __player: { getTime: () => 0, seek: vi.fn() },
    __hfStudioManualEditsApply: vi.fn(),
  };

  const appendedScripts: string[] = [];
  const realAppendChild = container.appendChild.bind(container);
  container.appendChild = <T extends Node>(node: T): T => {
    const result = realAppendChild(node);
    if (node instanceof HTMLScriptElement) appendedScripts.push(node.textContent ?? "");
    return result;
  };

  const contentDocument = {
    querySelectorAll: (sel: string) => (sel === "script:not([src])" ? scriptEls : []),
    createElement: (tag: string) => document.createElement(tag),
    body: container,
    head: document.createElement("div"),
  };

  return {
    iframe: { contentWindow, contentDocument } as unknown as HTMLIFrameElement,
    contentWindow,
    container,
    scriptEls,
    appendedScripts,
  };
}

describe("nothing-to-rewrite timing edits rebind in place (no script re-execution)", () => {
  it("single clip without a domId: rebinds + seeks, executes NO script, no full reload", async () => {
    // A selector-addressed clip (e.g. a .sub caption) has no domId, so there is
    // no GSAP mutation to run — the timing attributes are already live-patched
    // and __timelines is still valid, so the runtime only needs to re-derive
    // the clip windows (rebind) and re-seek. Re-running init-style scripts
    // (three.js setups etc.) is exactly the unsafe case this must avoid.
    const { iframe, contentWindow, container, scriptEls, appendedScripts } =
      buildLivePreviewIframe();
    const reloadPreview = vi.fn();

    await finishClipTimingFallback({
      ...clipFallbackInput({ reloadPreview, recordEdit: vi.fn(async () => {}) }),
      iframe,
      domId: undefined,
    });

    expect(reloadPreview).not.toHaveBeenCalled();
    expect(contentWindow.__hfForceTimelineRebind).toHaveBeenCalledTimes(1);
    expect(contentWindow.__player.seek).toHaveBeenCalledTimes(1);
    expect(contentWindow.__hfStudioManualEditsApply).toHaveBeenCalledTimes(1);
    // NO script executed, the original script element untouched in place.
    expect(appendedScripts).toHaveLength(0);
    expect(container.contains(scriptEls[0]!)).toBe(true);
    expect(scriptEls[0]!.textContent).toBe(LIVE_SCRIPT);
  });

  it("multi-script document (e.g. three.js + captions): rebind-only, both scripts untouched", async () => {
    // Real compositions commonly hold heavy inline scripts (main timeline,
    // three.js setup, captions). None of them may run twice — the rebind path
    // must not create, remove, or re-execute any of them.
    const { iframe, contentWindow, container, scriptEls, appendedScripts } = buildLivePreviewIframe(
      [LIVE_SCRIPT, LIVE_CAPTION_SCRIPT],
    );
    const rootKill = vi.fn();
    const captionsKill = vi.fn();
    contentWindow.__timelines = { root: { kill: rootKill }, captions: { kill: captionsKill } };
    const reloadPreview = vi.fn();

    await finishClipTimingFallback({
      ...clipFallbackInput({ reloadPreview, recordEdit: vi.fn(async () => {}) }),
      iframe,
      domId: undefined,
    });

    expect(reloadPreview).not.toHaveBeenCalled();
    expect(appendedScripts).toHaveLength(0);
    expect(container.contains(scriptEls[0]!)).toBe(true);
    expect(container.contains(scriptEls[1]!)).toBe(true);
    // The still-valid timelines are NOT killed — nothing re-registers them.
    expect(rootKill).not.toHaveBeenCalled();
    expect(captionsKill).not.toHaveBeenCalled();
    expect(contentWindow.__timelines.root).toBeDefined();
    expect(contentWindow.__timelines.captions).toBeDefined();
    // One finalization: one seek, one rebind.
    expect(contentWindow.__player.seek).toHaveBeenCalledTimes(1);
    expect(contentWindow.__hfForceTimelineRebind).toHaveBeenCalledTimes(1);
  });

  it("server-confirmed no-op with an unchanged script rebinds without executing any script", async () => {
    stubFetch([], {
      mutated: false,
      scriptText: LIVE_SCRIPT,
      before: "<same>",
      after: "<same>",
    });
    const { iframe, contentWindow, container, scriptEls, appendedScripts } = buildLivePreviewIframe(
      [LIVE_SCRIPT, LIVE_CAPTION_SCRIPT],
    );
    const reloadPreview = vi.fn();

    await finishClipTimingFallback({
      ...clipFallbackInput({ reloadPreview, recordEdit: vi.fn(async () => {}) }),
      iframe,
    });

    expect(reloadPreview).not.toHaveBeenCalled();
    expect(appendedScripts).toHaveLength(0);
    expect(scriptEls.every((script) => container.contains(script))).toBe(true);
    expect(contentWindow.__hfForceTimelineRebind).toHaveBeenCalledTimes(1);
  });

  it("comp with ZERO GSAP scripts also rebinds in place (previously full-reloaded)", async () => {
    // The rebind hook is installed by the runtime unconditionally — it does not
    // depend on GSAP — so a script-less comp gets the flashless path too.
    const { iframe, contentWindow, appendedScripts } = buildLivePreviewIframe([]);
    const reloadPreview = vi.fn();

    await finishClipTimingFallback({
      ...clipFallbackInput({ reloadPreview, recordEdit: vi.fn(async () => {}) }),
      iframe,
      domId: undefined,
    });

    expect(reloadPreview).not.toHaveBeenCalled();
    expect(contentWindow.__hfForceTimelineRebind).toHaveBeenCalledTimes(1);
    expect(contentWindow.__player.seek).toHaveBeenCalledTimes(1);
    expect(appendedScripts).toHaveLength(0);
  });

  it("full-reloads when the runtime rebind hook is unavailable", async () => {
    const { iframe, contentWindow, appendedScripts } = buildLivePreviewIframe();
    contentWindow.__hfForceTimelineRebind = undefined;
    const reloadPreview = vi.fn();

    await finishClipTimingFallback({
      ...clipFallbackInput({ reloadPreview, recordEdit: vi.fn(async () => {}) }),
      iframe,
      domId: undefined,
    });

    expect(reloadPreview).toHaveBeenCalledTimes(1);
    expect(appendedScripts).toHaveLength(0);
  });

  it("still full-reloads when the server MUTATED the file but returned no script", async () => {
    // mutated:true with scriptText:null (older server) means the live script is
    // now STALE relative to disk — a rebind against it would show wrong
    // positions.
    stubFetch(["<before>", "<before>", "<after>"], {
      mutated: true,
      scriptText: null,
      before: "<before>",
      after: "<after>",
    });
    const { iframe, contentWindow, appendedScripts } = buildLivePreviewIframe();
    const reloadPreview = vi.fn();

    await finishClipTimingFallback({
      ...clipFallbackInput({ reloadPreview, recordEdit: vi.fn(async () => {}) }),
      iframe,
    });

    expect(reloadPreview).toHaveBeenCalledTimes(1);
    expect(contentWindow.__hfForceTimelineRebind).not.toHaveBeenCalled();
    expect(appendedScripts).toHaveLength(0);
  });

  it("mutated WITH a rewritten script keeps the script-swap soft path (not rebind-only)", async () => {
    // A genuine rewrite must re-run the REWRITTEN script — the rebind-only
    // shortcut is reserved for the no-op case where every script is unchanged.
    stubFetch(["<before>", "<before>", "<after>"], {
      mutated: true,
      scriptText: 'window.__timelines["root"] = tl2;',
      before: "<before>",
      after: "<after>",
    });
    const { iframe, contentWindow, appendedScripts } = buildLivePreviewIframe();
    const reloadPreview = vi.fn();

    await finishClipTimingFallback({
      ...clipFallbackInput({ reloadPreview, recordEdit: vi.fn(async () => {}) }),
      iframe,
    });

    expect(reloadPreview).not.toHaveBeenCalled();
    expect(appendedScripts).toHaveLength(1);
    expect(appendedScripts[0]).toContain('__timelines["root"] = tl2;');
    expect(contentWindow.__hfForceTimelineRebind).toHaveBeenCalledTimes(1);
  });

  it("group batch where every change had nothing to rewrite (gap close over no-domId clips) rebinds in place", async () => {
    stubFetch(["<html>"], { mutated: false, scriptText: null });
    const { iframe, contentWindow, container, scriptEls, appendedScripts } =
      buildLivePreviewIframe();
    const reloadPreview = vi.fn();
    const element = { sourceFile: "index.html" } as TimelineElement;

    await finishGroupTimingGsapFallback({
      projectId: "p1",
      iframe,
      reloadPreview,
      label: "Move timeline clips",
      errorLabel: "Failed to shift GSAP positions",
      recordEdit: vi.fn(async () => {}) as never,
      activeCompPath: "index.html",
      changes: [{ element }, { element }],
      resolveChangePath: () => "index.html",
      // No domId → nothing to rewrite for ANY change (the gap-close blink path).
      mutateChange: () => null,
    });

    expect(reloadPreview).not.toHaveBeenCalled();
    expect(contentWindow.__hfForceTimelineRebind).toHaveBeenCalledTimes(1);
    expect(contentWindow.__player.seek).toHaveBeenCalledTimes(1);
    // No script executed, the live script element untouched.
    expect(appendedScripts).toHaveLength(0);
    expect(container.contains(scriptEls[0]!)).toBe(true);
  });

  it("group batch touching ANOTHER file still full-reloads even when nothing was rewritten", async () => {
    stubFetch(["<html>"], { mutated: false, scriptText: null });
    const { iframe, contentWindow, appendedScripts } = buildLivePreviewIframe();
    const reloadPreview = vi.fn();

    await finishGroupTimingGsapFallback({
      projectId: "p1",
      iframe,
      reloadPreview,
      label: "Move timeline clips",
      errorLabel: "Failed to shift GSAP positions",
      recordEdit: vi.fn(async () => {}) as never,
      activeCompPath: "index.html",
      changes: [
        { element: { sourceFile: "index.html" } as TimelineElement },
        { element: { sourceFile: "scenes/intro.html" } as TimelineElement },
      ],
      resolveChangePath: (el) => el.sourceFile ?? "index.html",
      mutateChange: () => null,
    });

    expect(reloadPreview).toHaveBeenCalledTimes(1);
    expect(contentWindow.__hfForceTimelineRebind).not.toHaveBeenCalled();
    expect(appendedScripts).toHaveLength(0);
  });
});

function installOwnedFileServer(
  contents: Map<string, string>,
  options: {
    failReadAt?: number;
    failRollback?: boolean;
    beforeRollback?: (path: string) => void;
  } = {},
) {
  let reads = 0;
  const rollbacks: Array<{ path: string; expected: string; restore: string; conflict: boolean }> =
    [];
  vi.stubGlobal(
    "fetch",
    // One in-memory server fixture owns capability, file, and CAS rollback
    // routes so each transaction test observes a coherent content map.
    // fallow-ignore-next-line complexity
    vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.includes("/gsap-mutation-capabilities")) {
        return jsonResponse({ atomicOwnershipPairs: true });
      }
      if (url.includes("/files/")) {
        reads += 1;
        if (reads === options.failReadAt) throw new Error("verification read failed");
        const path = decodeURIComponent(url.split("/files/")[1] ?? "");
        return jsonResponse({ content: contents.get(path) ?? "" });
      }
      if (url.includes("/gsap-mutation-rollback/")) {
        const path = decodeURIComponent(url.split("/gsap-mutation-rollback/")[1] ?? "");
        const body = JSON.parse(String(init?.body)) as { expected: string; restore: string };
        if (options.failRollback) {
          return new Response(JSON.stringify({ error: "rollback unavailable" }), { status: 503 });
        }
        options.beforeRollback?.(path);
        const conflict = contents.get(path) !== body.expected;
        if (!conflict) contents.set(path, body.restore);
        rollbacks.push({ path, ...body, conflict });
        return jsonResponse({ ok: true, restored: !conflict, conflict });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }),
  );
  return { rollbacks, readCount: () => reads };
}

function ownedMutation(contents: Map<string, string>, path: string, before: string, after: string) {
  contents.set(path, after);
  return { mutated: true, scriptText: null, before, after };
}

describe("foldGsapMutationIntoHistory — owned GSAP transaction", () => {
  const element = { sourceFile: "index.html" } as TimelineElement;

  it("reverse-rolls back every successful same-file step after a late failure", async () => {
    const contents = new Map<string, string>([["index.html", "ORIGINAL"]]);
    const server = installOwnedFileServer(contents);
    let clipIndex = 0;

    await finishGroupTimingGsapFallback({
      projectId: "p1",
      iframe: buildLivePreviewIframe().iframe,
      reloadPreview: vi.fn(),
      label: "Move timeline clips",
      errorLabel: "Failed to shift GSAP positions",
      recordEdit: vi.fn(async () => {}) as never,
      activeCompPath: "index.html",
      changes: [{ element }, { element }, { element }],
      resolveChangePath: () => "index.html",
      mutateChange: async () => {
        clipIndex += 1;
        if (clipIndex === 1) return ownedMutation(contents, "index.html", "ORIGINAL", "STEP-1");
        if (clipIndex === 2) return ownedMutation(contents, "index.html", "STEP-1", "STEP-2");
        throw new Error("late failure");
      },
    });

    expect(server.rollbacks).toEqual([
      { path: "index.html", expected: "STEP-2", restore: "STEP-1", conflict: false },
      { path: "index.html", expected: "STEP-1", restore: "ORIGINAL", conflict: false },
    ]);
    expect(contents.get("index.html")).toBe("ORIGINAL");
  });

  it("uses the endpoint's atomic before when a foreign write precedes mutation", async () => {
    const contents = new Map<string, string>([["index.html", "FOREIGN"]]);
    const server = installOwnedFileServer(contents);
    let clipIndex = 0;

    await finishGroupTimingGsapFallback({
      projectId: "p1",
      iframe: buildLivePreviewIframe().iframe,
      reloadPreview: vi.fn(),
      label: "Move timeline clips",
      errorLabel: "Failed to shift GSAP positions",
      recordEdit: vi.fn(async () => {}) as never,
      activeCompPath: "index.html",
      changes: [{ element }, { element }],
      resolveChangePath: () => "index.html",
      mutateChange: async () => {
        clipIndex += 1;
        if (clipIndex === 1) {
          return ownedMutation(contents, "index.html", "FOREIGN", "FOREIGN+OWNED");
        }
        throw new Error("late failure");
      },
    });

    expect(server.readCount()).toBe(0);
    expect(server.rollbacks[0]).toEqual({
      path: "index.html",
      expected: "FOREIGN+OWNED",
      restore: "FOREIGN",
      conflict: false,
    });
    expect(contents.get("index.html")).toBe("FOREIGN");
  });

  it("server CAS preserves a successor that arrives as rollback starts", async () => {
    const contents = new Map<string, string>([["index.html", "ORIGINAL"]]);
    const server = installOwnedFileServer(contents, {
      beforeRollback: () => contents.set("index.html", "SUCCESSOR"),
    });
    let clipIndex = 0;

    const reloadPreview = vi.fn();
    await finishGroupTimingGsapFallback({
      projectId: "p1",
      iframe: buildLivePreviewIframe().iframe,
      reloadPreview,
      label: "Move timeline clips",
      errorLabel: "Failed to shift GSAP positions",
      recordEdit: vi.fn(async () => {}) as never,
      activeCompPath: "index.html",
      changes: [{ element }, { element }],
      resolveChangePath: () => "index.html",
      mutateChange: async () => {
        clipIndex += 1;
        if (clipIndex === 1) return ownedMutation(contents, "index.html", "ORIGINAL", "OWNED");
        throw new Error("late failure");
      },
    });

    expect(server.rollbacks[0]?.conflict).toBe(true);
    expect(contents.get("index.html")).toBe("SUCCESSOR");
    expect(reloadPreview).toHaveBeenCalledTimes(1);
  });

  it("reloads when a failed rollback request leaves owned bytes without history", async () => {
    const contents = new Map<string, string>([["index.html", "ORIGINAL"]]);
    installOwnedFileServer(contents, { failRollback: true });
    const reloadPreview = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    let clipIndex = 0;

    await finishGroupTimingGsapFallback({
      projectId: "p1",
      iframe: buildLivePreviewIframe().iframe,
      reloadPreview,
      label: "Move timeline clips",
      errorLabel: "Failed to shift GSAP positions",
      recordEdit: vi.fn(async () => {}) as never,
      activeCompPath: "index.html",
      changes: [{ element }, { element }],
      resolveChangePath: () => "index.html",
      mutateChange: async () => {
        clipIndex += 1;
        if (clipIndex === 1) return ownedMutation(contents, "index.html", "ORIGINAL", "OWNED");
        throw new Error("late failure");
      },
    });

    expect(contents.get("index.html")).toBe("OWNED");
    expect(reloadPreview).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("GSAP"),
      expect.objectContaining({ message: "Failed to restore index.html" }),
    );
  });

  it("records first owned before and last owned after without a client snapshot", async () => {
    const contents = new Map<string, string>([["index.html", "FOREIGN"]]);
    const server = installOwnedFileServer(contents);
    const recordEdit = vi.fn(async () => {});

    await finishGroupTimingGsapFallback({
      projectId: "p1",
      iframe: buildLivePreviewIframe().iframe,
      reloadPreview: vi.fn(),
      label: "Move timeline clips",
      errorLabel: "Failed to shift GSAP positions",
      recordEdit: recordEdit as never,
      activeCompPath: "index.html",
      changes: [{ element }, { element }],
      resolveChangePath: () => "index.html",
      mutateChange: async (_change, _path) => {
        const before = contents.get("index.html")!;
        const after = before === "FOREIGN" ? "FOREIGN+ONE" : "FOREIGN+ONE+TWO";
        return ownedMutation(contents, "index.html", before, after);
      },
    });

    expect(server.readCount()).toBe(1); // final ownership verification only
    expect(recordEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        files: {
          "index.html": { before: "FOREIGN", after: "FOREIGN+ONE+TWO" },
        },
      }),
    );
  });

  it("rejects a discontinuous same-file chain without claiming foreign bytes", async () => {
    const contents = new Map<string, string>([["index.html", "ORIGINAL"]]);
    const server = installOwnedFileServer(contents);
    const recordEdit = vi.fn(async () => {});
    let clipIndex = 0;

    const reloadPreview = vi.fn();
    await finishGroupTimingGsapFallback({
      projectId: "p1",
      iframe: buildLivePreviewIframe().iframe,
      reloadPreview,
      label: "Move timeline clips",
      errorLabel: "Failed to shift GSAP positions",
      recordEdit: recordEdit as never,
      activeCompPath: "index.html",
      changes: [{ element }, { element }],
      resolveChangePath: () => "index.html",
      mutateChange: async () => {
        clipIndex += 1;
        if (clipIndex === 1) return ownedMutation(contents, "index.html", "ORIGINAL", "STEP-1");
        return ownedMutation(contents, "index.html", "FOREIGN", "FOREIGN+STEP-2");
      },
    });

    expect(recordEdit).not.toHaveBeenCalled();
    expect(server.rollbacks).toEqual([
      {
        path: "index.html",
        expected: "FOREIGN+STEP-2",
        restore: "FOREIGN",
        conflict: false,
      },
      { path: "index.html", expected: "STEP-1", restore: "ORIGINAL", conflict: true },
    ]);
    expect(contents.get("index.html")).toBe("FOREIGN");
    expect(reloadPreview).toHaveBeenCalledTimes(1);
  });

  it("rolls back the owned output when the history verification reread fails", async () => {
    const contents = new Map<string, string>([["index.html", "ORIGINAL"]]);
    const server = installOwnedFileServer(contents, { failReadAt: 1 });

    await finishGroupTimingGsapFallback({
      projectId: "p1",
      iframe: buildLivePreviewIframe().iframe,
      reloadPreview: vi.fn(),
      label: "Move timeline clips",
      errorLabel: "Failed to shift GSAP positions",
      recordEdit: vi.fn(async () => {}) as never,
      activeCompPath: "index.html",
      changes: [{ element }],
      resolveChangePath: () => "index.html",
      mutateChange: async () => ownedMutation(contents, "index.html", "ORIGINAL", "OWNED"),
    });

    expect(server.rollbacks[0]).toEqual({
      path: "index.html",
      expected: "OWNED",
      restore: "ORIGINAL",
      conflict: false,
    });
    expect(contents.get("index.html")).toBe("ORIGINAL");
  });
});
