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
 * last entry), the GSAP-mutation endpoint answers with `gsapBody` (a thrown
 * Error rejects the call with a non-ok response).
 */
function stubFetch(fileContents: string[], gsapBody: unknown | Error) {
  let readIndex = 0;
  const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
    const url = requestUrl(input);
    if (url.includes("/files/")) {
      const content = fileContents[Math.min(readIndex, fileContents.length - 1)];
      readIndex += 1;
      return jsonResponse({ content });
    }
    if (url.includes("/gsap-mutations/")) {
      if (gsapBody instanceof Error) {
        return new Response(JSON.stringify({ error: gsapBody.message }), { status: 500 });
      }
      return jsonResponse(gsapBody);
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
  it("still syncs the preview when the history-fold step fails after a successful mutation", async () => {
    // Mutation succeeds (server rewrite already on disk), but recordEdit (the
    // fold step) throws. The preview MUST still be synced — otherwise stale
    // GSAP positions stay on screen. iframe=null makes the sync observable as
    // one reloadPreview() call.
    stubFetch(["<before>", "<after>"], { mutated: true, scriptText: "tl.to()" });
    const reloadPreview = vi.fn();
    const foldError = new Error("history fold failed");
    const recordEdit = vi.fn(async () => {
      throw foldError;
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await finishClipTimingFallback(clipFallbackInput({ reloadPreview, recordEdit }));

    expect(recordEdit).toHaveBeenCalledTimes(1);
    expect(reloadPreview).toHaveBeenCalledTimes(1);
    // The fold error is surfaced, not swallowed silently.
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("GSAP"), foldError);
  });

  it("skips the preview sync when the MUTATION itself fails", async () => {
    stubFetch(["<before>"], new Error("mutation blew up"));
    const reloadPreview = vi.fn();
    const recordEdit = vi.fn(async () => {});
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await finishClipTimingFallback(clipFallbackInput({ reloadPreview, recordEdit }));

    expect(recordEdit).not.toHaveBeenCalled();
    expect(reloadPreview).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it("records the fold and syncs on the happy path", async () => {
    stubFetch(["<before>", "<after>"], { mutated: true, scriptText: "tl.to()" });
    const reloadPreview = vi.fn();
    const recordEdit = vi.fn(async () => {});

    await finishClipTimingFallback(clipFallbackInput({ reloadPreview, recordEdit }));

    expect(recordEdit).toHaveBeenCalledTimes(1);
    expect(reloadPreview).toHaveBeenCalledTimes(1);
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
    const fetchMock = stubFetch([], { mutated: false, scriptText: null });
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
    stubFetch(["<before>", "<after>"], { mutated: true, scriptText: null });
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
    stubFetch(["<before>", "<after>"], {
      mutated: true,
      scriptText: 'window.__timelines["root"] = tl2;',
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
