// @vitest-environment happy-dom

import { describe, it, expect, vi } from "vitest";
import {
  applySoftReload,
  ensureMotionPathPluginLoaded,
  diffSoftReloadableRestore,
  applyUndoRestoreToPreview,
} from "./gsapSoftReload";

const SCRIPT_TEXT = `
window.__timelines = window.__timelines || {};
const tl = gsap.timeline({ paused: true });
tl.to("#box", { opacity: 0.8 });
window.__timelines["root"] = tl;
`;

const MOTION_PATH_SCRIPT_TEXT = `
window.__timelines = window.__timelines || {};
const tl = gsap.timeline({ paused: true });
tl.to("#box", { motionPath: { path: [{ x: 0, y: 0 }, { x: 100, y: 50 }] } });
window.__timelines["root"] = tl;
`;

function buildMockIframe(overrides: Record<string, unknown> = {}) {
  const scriptEl = document.createElement("script");
  scriptEl.textContent =
    'const tl = gsap.timeline({ paused: true }); tl.to("#box", { opacity: 0.5 });';
  const container = document.createElement("div");
  container.appendChild(scriptEl);

  const mockTimeline = { kill: vi.fn(), pause: vi.fn() };
  const contentWindow = {
    gsap: { timeline: vi.fn() },
    __hfForceTimelineRebind: vi.fn(),
    __timelines: { root: mockTimeline } as Record<string, typeof mockTimeline>,
    __player: { getTime: () => 2.0, seek: vi.fn() },
    __hfStudioManualEditsApply: vi.fn(),
    __hfSuppressSceneMutations: undefined as undefined | (<T>(fn: () => T) => T),
    ...overrides,
  };

  // Intercept appendChild: when a <script> is appended, simulate execution by
  // repopulating __timelines (mimicking what the real GSAP script would do).
  const realAppendChild = container.appendChild.bind(container);
  container.appendChild = <T extends Node>(node: T): T => {
    const result = realAppendChild(node);
    if (node instanceof HTMLScriptElement && node.textContent?.includes("gsap.timeline")) {
      // Simulate the script populating __timelines
      const cw = contentWindow as { __timelines?: Record<string, unknown> };
      if (cw.__timelines) {
        cw.__timelines.root = { kill: vi.fn(), pause: vi.fn() };
      }
    }
    return result;
  };

  const contentDocument = {
    querySelectorAll: (sel: string) => (sel === "script:not([src])" ? [scriptEl] : []),
    createElement: (tag: string) => document.createElement(tag),
    body: container,
    head: document.createElement("div"),
  };

  return {
    iframe: { contentWindow, contentDocument } as unknown as HTMLIFrameElement,
    contentWindow,
    mockTimeline,
  };
}

describe("applySoftReload", () => {
  it('returns "cannot-soft-reload" when iframe is null', () => {
    expect(applySoftReload(null, SCRIPT_TEXT)).toBe("cannot-soft-reload");
  });

  it('returns "cannot-soft-reload" when scriptText is empty', () => {
    const { iframe } = buildMockIframe();
    expect(applySoftReload(iframe, "")).toBe("cannot-soft-reload");
  });

  it('returns "cannot-soft-reload" when gsap is not on iframe window', () => {
    const { iframe } = buildMockIframe({ gsap: undefined });
    expect(applySoftReload(iframe, SCRIPT_TEXT)).toBe("cannot-soft-reload");
  });

  it('returns "cannot-soft-reload" when __hfForceTimelineRebind is missing', () => {
    const { iframe } = buildMockIframe({ __hfForceTimelineRebind: undefined });
    expect(applySoftReload(iframe, SCRIPT_TEXT)).toBe("cannot-soft-reload");
  });

  it('returns "cannot-soft-reload" when the script registers no scopable key', () => {
    // No __timelines["key"] pattern → targetKeys is empty → can't scope safely.
    const { iframe } = buildMockIframe();
    expect(applySoftReload(iframe, 'gsap.to("#box", { x: 1 });')).toBe("cannot-soft-reload");
  });

  it("kills existing timelines, rebinds, and re-seeks on success", () => {
    const { iframe, contentWindow, mockTimeline } = buildMockIframe();
    const result = applySoftReload(iframe, SCRIPT_TEXT);
    expect(result).toBe("applied");
    expect(mockTimeline.kill).toHaveBeenCalled();
    expect(contentWindow.__hfForceTimelineRebind).toHaveBeenCalled();
    expect(contentWindow.__player.seek).toHaveBeenCalledWith(2.0);
    expect(contentWindow.__hfStudioManualEditsApply).toHaveBeenCalled();
  });

  it("seeks to the caller-supplied currentTime override instead of the iframe's own __player.getTime()", () => {
    // Regression: the iframe's raw __player.getTime() (2.0 here, per the mock)
    // can desync from the studio's authoritative scrub position — e.g. a
    // keyframe-node drag parks the playhead via the store before this reload's
    // async commit resolves. The rebuilt timeline must re-seek to the caller's
    // value, not the iframe's possibly-stale one.
    const { iframe, contentWindow } = buildMockIframe();
    const result = applySoftReload(iframe, SCRIPT_TEXT, { currentTimeOverride: 0 });
    expect(result).toBe("applied");
    expect(contentWindow.__player.seek).toHaveBeenCalledWith(0);
  });

  it("strips a stale inline transform from an orphaned (non-timeline-child) element", () => {
    // Repro: an element dragged via gsap.set whose keyframes were then removed is
    // no longer a timeline child, so the timeline-children sweep misses it. Its
    // stale inline transform must still be cleared so it snaps back to its source
    // (overlay) position instead of rendering offset.
    const orphan = document.createElement("div");
    orphan.style.cssText = "left: 1240px; top: 200px; transform: translate(449px, 0px)";
    Object.assign(orphan, { _gsap: {} }); // GSAP cache marker (set by gsap.set)

    const scriptEl = document.createElement("script");
    scriptEl.textContent = 'const tl = gsap.timeline({ paused: true }); tl.to("#x", { x: 1 });';
    const container = document.createElement("div");
    container.appendChild(scriptEl);

    const { iframe } = buildMockIframe({ gsap: { timeline: vi.fn(), set: vi.fn() } });
    (iframe as unknown as { contentDocument: unknown }).contentDocument = {
      querySelectorAll: (sel: string) =>
        sel === "script:not([src])" ? [scriptEl] : sel === "[style*='transform']" ? [orphan] : [],
      createElement: (tag: string) => document.createElement(tag),
      body: container,
      head: document.createElement("div"),
    };

    applySoftReload(iframe, SCRIPT_TEXT);

    expect(orphan.style.transform).toBe(""); // stale GSAP transform stripped
    expect(orphan.style.left).toBe("1240px"); // authored CSS base preserved
  });

  it("wraps execution in __hfSuppressSceneMutations when available", () => {
    let suppressionCalled = false;
    const { iframe } = buildMockIframe({
      __hfSuppressSceneMutations: <T>(fn: () => T): T => {
        suppressionCalled = true;
        return fn();
      },
    });
    const result = applySoftReload(iframe, SCRIPT_TEXT);
    expect(result).toBe("applied");
    expect(suppressionCalled).toBe(true);
  });

  it('returns "applied" when the re-run re-registers the script\'s expected key', () => {
    // SCRIPT_TEXT registers __timelines["root"]; buildMockIframe's appendChild
    // shim repopulates `root` on execution. The hardened verify checks the
    // expected target key is present (not merely "some key"), so a correct re-run
    // reliably reports "applied" — it doesn't spuriously hit the transient window.
    const { iframe, contentWindow } = buildMockIframe();
    expect(applySoftReload(iframe, SCRIPT_TEXT)).toBe("applied");
    expect(contentWindow.__timelines.root).toBeDefined();
  });

  it('returns "verify-failed" (transient) when the re-run leaves the key empty', () => {
    // No appendChild shim repopulation: the body container has no shim, so the
    // re-run kills __timelines["root"] and the new script doesn't re-register it.
    // That is the TRANSIENT post-run window — surfaced as "verify-failed" so
    // callers know NOT to escalate (the live gsap.set already shows the value).
    const scriptEl = document.createElement("script");
    scriptEl.textContent = 'window.__timelines["root"] = gsap.timeline();';
    const container = document.createElement("div"); // no appendChild shim
    container.appendChild(scriptEl);
    const { iframe } = buildMockIframe();
    (iframe as unknown as { contentDocument: unknown }).contentDocument = {
      querySelectorAll: (sel: string) => (sel === "script:not([src])" ? [scriptEl] : []),
      createElement: (tag: string) => document.createElement(tag),
      body: container,
      head: document.createElement("div"),
    };
    expect(applySoftReload(iframe, SCRIPT_TEXT)).toBe("verify-failed");
  });

  it("editing composition A leaves composition B's timeline intact (scoped kill)", () => {
    // Two comps live side by side; the soft reload only re-runs comp "root".
    // Comp "subscene" must survive untouched — the regression the full remount
    // (re-inline) used to cause.
    const subsceneTimeline = { kill: vi.fn(), pause: vi.fn() };
    const { iframe, contentWindow, mockTimeline } = buildMockIframe({
      __timelines: {
        root: { kill: vi.fn(), pause: vi.fn() },
        subscene: subsceneTimeline,
      } as Record<string, { kill: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn> }>,
    });
    void mockTimeline;

    expect(applySoftReload(iframe, SCRIPT_TEXT)).toBe("applied");
    // Comp B was never killed and is still registered.
    expect(subsceneTimeline.kill).not.toHaveBeenCalled();
    expect(contentWindow.__timelines.subscene).toBe(subsceneTimeline);
  });

  it("runs synchronously (no async plugin load) when MotionPathPlugin is already present", () => {
    // The preview bootstrap pre-loads MotionPathPlugin, so win.MotionPathPlugin
    // is set before any motion-path edit. The soft reload must then execute the
    // script inline — no CDN <script> appended to <head>, the timeline is
    // repopulated synchronously, and verifyTimelinesPopulated reports the real
    // result (not the optimistic-true async path).
    const headAppends: Node[] = [];
    const head = document.createElement("div");
    const realHeadAppend = head.appendChild.bind(head);
    head.appendChild = <T extends Node>(node: T): T => {
      headAppends.push(node);
      return realHeadAppend(node);
    };
    const { iframe, contentWindow } = buildMockIframe({ MotionPathPlugin: {} });
    (iframe.contentDocument as unknown as { head: unknown }).head = head;

    const result = applySoftReload(iframe, MOTION_PATH_SCRIPT_TEXT);

    expect(result).toBe("applied");
    // No CDN plugin <script> was appended to <head> — ran inline.
    expect(headAppends.filter((n) => n instanceof HTMLScriptElement)).toHaveLength(0);
    expect(contentWindow.__hfForceTimelineRebind).toHaveBeenCalled();
    expect(contentWindow.__player.seek).toHaveBeenCalledWith(2.0);
    expect(contentWindow.__timelines.root).toBeDefined();
  });

  it("falls back to the async plugin load when MotionPathPlugin is genuinely absent", () => {
    const head = document.createElement("div");
    const appendedScripts: HTMLScriptElement[] = [];
    const realHeadAppend = head.appendChild.bind(head);
    head.appendChild = <T extends Node>(node: T): T => {
      if (node instanceof HTMLScriptElement) appendedScripts.push(node);
      return realHeadAppend(node);
    };
    // gsap present but MotionPathPlugin unset → async load path.
    const { iframe, contentWindow } = buildMockIframe({
      MotionPathPlugin: undefined,
      gsap: { timeline: vi.fn(), registerPlugin: vi.fn() },
    });
    (iframe.contentDocument as unknown as { head: unknown }).head = head;

    const onAsyncFailure = vi.fn();
    const result = applySoftReload(iframe, MOTION_PATH_SCRIPT_TEXT, { onAsyncFailure });

    // Optimistically "applied" (script will run once the plugin loads) — and the
    // script has NOT executed yet, so the timeline isn't rebound synchronously.
    expect(result).toBe("applied");
    expect(appendedScripts).toHaveLength(1);
    expect(appendedScripts[0]!.src).toContain("MotionPathPlugin");
    expect(contentWindow.__hfForceTimelineRebind).not.toHaveBeenCalled();

    // onerror must NOT run the script (that would reference a missing plugin) —
    // it escalates via onAsyncFailure so the caller can full-reload to recover,
    // and clears the in-flight loading flag.
    appendedScripts[0]!.onerror?.(new Event("error"));
    expect(onAsyncFailure).toHaveBeenCalledTimes(1);
    expect(contentWindow.__hfForceTimelineRebind).not.toHaveBeenCalled();
    expect(contentWindow.__hfMotionPathPluginLoading).toBe(false);
  });

  it('returns "cannot-soft-reload" when multiple GSAP scripts exist (ambiguous)', () => {
    const script1 = document.createElement("script");
    script1.textContent = "const tl = gsap.timeline({ paused: true });";
    const script2 = document.createElement("script");
    script2.textContent = 'tl.to("#other", { x: 10 });';
    const container = document.createElement("div");
    container.appendChild(script1);
    container.appendChild(script2);

    const { iframe } = buildMockIframe();
    (iframe as unknown as { contentDocument: unknown }).contentDocument = {
      querySelectorAll: (sel: string) => (sel === "script:not([src])" ? [script1, script2] : []),
      createElement: (tag: string) => document.createElement(tag),
      body: container,
    };
    // Multiple scripts, none registering "root" → can't identify what to replace
    // → structural failure that genuinely needs a full reload.
    expect(applySoftReload(iframe, SCRIPT_TEXT)).toBe("cannot-soft-reload");
  });
});

function buildBootstrapIframe(overrides: Record<string, unknown> = {}) {
  const head = document.createElement("div");
  const appendedScripts: HTMLScriptElement[] = [];
  const realHeadAppend = head.appendChild.bind(head);
  head.appendChild = <T extends Node>(node: T): T => {
    if (node instanceof HTMLScriptElement) appendedScripts.push(node);
    return realHeadAppend(node);
  };

  const registerPlugin = vi.fn();
  const contentWindow = {
    gsap: { registerPlugin } as Record<string, unknown> | undefined,
    MotionPathPlugin: undefined as unknown,
    __hfMotionPathPluginLoading: undefined as boolean | undefined,
    ...overrides,
  };
  const contentDocument = {
    createElement: (tag: string) => document.createElement(tag),
    head,
  };
  return {
    iframe: { contentWindow, contentDocument } as unknown as HTMLIFrameElement,
    contentWindow,
    appendedScripts,
    registerPlugin,
  };
}

describe("ensureMotionPathPluginLoaded", () => {
  it("no-ops when the iframe is null", () => {
    expect(() => ensureMotionPathPluginLoaded(null)).not.toThrow();
  });

  it("no-ops when gsap is unavailable", () => {
    const { iframe, appendedScripts } = buildBootstrapIframe({ gsap: undefined });
    ensureMotionPathPluginLoaded(iframe);
    expect(appendedScripts).toHaveLength(0);
  });

  it("appends the plugin script once and registers it on load", () => {
    const { iframe, contentWindow, appendedScripts, registerPlugin } = buildBootstrapIframe();
    ensureMotionPathPluginLoaded(iframe);
    expect(appendedScripts).toHaveLength(1);
    expect(appendedScripts[0]!.src).toContain("MotionPathPlugin");
    expect(contentWindow.__hfMotionPathPluginLoading).toBe(true);

    // Simulate the CDN load completing; the plugin is now present.
    contentWindow.MotionPathPlugin = {};
    appendedScripts[0]!.onload?.(new Event("load"));
    expect(registerPlugin).toHaveBeenCalledWith(contentWindow.MotionPathPlugin);
    expect(contentWindow.__hfMotionPathPluginLoading).toBe(false);
  });

  it("is idempotent: a second call while loading does not append a second script", () => {
    const { iframe, appendedScripts } = buildBootstrapIframe();
    ensureMotionPathPluginLoaded(iframe);
    ensureMotionPathPluginLoaded(iframe);
    expect(appendedScripts).toHaveLength(1);
  });

  it("registers an already-present plugin without appending a script", () => {
    const plugin = {};
    const { iframe, appendedScripts, registerPlugin } = buildBootstrapIframe({
      MotionPathPlugin: plugin,
    });
    ensureMotionPathPluginLoaded(iframe);
    expect(appendedScripts).toHaveLength(0);
    expect(registerPlugin).toHaveBeenCalledWith(plugin);
  });

  it("clears the loading flag and still resolves when the CDN load errors", () => {
    const { iframe, contentWindow, appendedScripts } = buildBootstrapIframe();
    ensureMotionPathPluginLoaded(iframe);
    appendedScripts[0]!.onerror?.(new Event("error"));
    expect(contentWindow.__hfMotionPathPluginLoading).toBe(false);
    // A subsequent call can retry (plugin still absent, flag cleared).
    ensureMotionPathPluginLoaded(iframe);
    expect(appendedScripts).toHaveLength(2);
  });
});

// The authored-opacity restore: before the script re-runs (and its tweens
// re-capture bounds), every animated element's inline opacity must be put back
// to its AUTHORED value — from the after-write file HTML when provided, else
// from the parse-time stamp. Otherwise a runtime transient (the color-grading
// hide's 0, a mid-flight tween value) becomes a permanent tween bound.
describe("applySoftReload authored-opacity restore", () => {
  function buildIframeWithTarget(el: HTMLElement, overrides: Record<string, unknown> = {}) {
    const scriptEl = document.createElement("script");
    scriptEl.textContent =
      'const tl = gsap.timeline({ paused: true }); tl.to("#box", { opacity: 0.5 });';
    const tl = {
      kill: vi.fn(),
      pause: vi.fn(),
      getChildren: () => [{ targets: () => [el] }],
    };
    const contentWindow = {
      gsap: { timeline: vi.fn(), set: vi.fn() },
      __hfForceTimelineRebind: vi.fn(),
      __timelines: { root: tl } as Record<string, unknown>,
      __player: { getTime: () => 2.0, seek: vi.fn() },
      __hfStudioManualEditsApply: vi.fn(),
      ...overrides,
    };
    const container = document.createElement("div");
    container.appendChild(scriptEl);
    // Intercept only POST-SETUP appends: simulate the re-run script
    // repopulating __timelines (as in buildMockIframe).
    const realAppendChild = container.appendChild.bind(container);
    container.appendChild = <T extends Node>(node: T): T => {
      const result = realAppendChild(node);
      if (node instanceof HTMLScriptElement && node.textContent?.includes("gsap.timeline")) {
        contentWindow.__timelines.root = { kill: vi.fn(), pause: vi.fn() };
      }
      return result;
    };
    const contentDocument = {
      querySelectorAll: (sel: string) => (sel === "script:not([src])" ? [scriptEl] : []),
      createElement: (tag: string) => document.createElement(tag),
      body: container,
      head: document.createElement("div"),
    };
    return { iframe: { contentWindow, contentDocument } as unknown as HTMLIFrameElement };
  }

  /** Run one restore cycle over `el` and return the final inline opacity. */
  function restoreOpacity(el: HTMLElement, authoredHtml?: string): string {
    const { iframe } = buildIframeWithTarget(el);
    expect(applySoftReload(iframe, SCRIPT_TEXT, authoredHtml ? { authoredHtml } : {})).toBe(
      "applied",
    );
    return el.style.getPropertyValue("opacity");
  }

  it("restores opacity from the after-write HTML (matched by data-hf-id)", () => {
    const el = document.createElement("img");
    el.setAttribute("data-hf-id", "hf-1");
    el.style.setProperty("opacity", "0", "important"); // the grading hide

    const opacity = restoreOpacity(
      el,
      '<html><body><img data-hf-id="hf-1" style="opacity: 0.98"></body></html>',
    );

    expect(opacity).toBe("0.98");
    expect(el.style.getPropertyPriority("opacity")).toBe("");
  });

  it("falls back to the parse-time stamp when no after-write HTML is given", () => {
    const el = document.createElement("img");
    el.setAttribute("data-hf-authored-opacity", "0.75");
    el.style.opacity = "0.123"; // mid-flight tween transient

    expect(restoreOpacity(el)).toBe("0.75");
  });

  it("an empty stamp (authored none) removes the inline opacity", () => {
    const el = document.createElement("img");
    el.setAttribute("data-hf-authored-opacity", "");
    el.style.opacity = "0";

    expect(restoreOpacity(el)).toBe("");
  });
});

// ── Bug 2: undo/redo restore soft-apply ──────────────────────────────────────

const wrap = (body: string) => `<html><body>${body}</body></html>`;

describe("diffSoftReloadableRestore", () => {
  it("reports the changed id for an attribute/inline-style-only diff", () => {
    const prev = wrap(`<div id="a" style="translate: 10px 10px">t</div>`);
    const next = wrap(`<div id="a" style="translate: 0px 0px">t</div>`);
    expect(diffSoftReloadableRestore(prev, next)).toEqual({ changedElementIds: ["a"] });
  });

  it("treats a structural change (added element) as NOT soft-reloadable", () => {
    const prev = wrap(`<div id="a">t</div>`);
    const next = wrap(`<div id="a">t</div><div id="a-split">t</div>`);
    expect(diffSoftReloadableRestore(prev, next)).toBeNull();
  });

  it("treats an element text/child change as NOT soft-reloadable", () => {
    const prev = wrap(`<div id="a">one</div>`);
    const next = wrap(`<div id="a">two</div>`);
    expect(diffSoftReloadableRestore(prev, next)).toBeNull();
  });

  it("allows a GSAP-script-only change (no id'd-attribute diff)", () => {
    const prev = wrap(
      `<div id="a">t</div><script>window.__timelines["root"]=gsap.timeline().to("#a",{x:1});</script>`,
    );
    const next = wrap(
      `<div id="a">t</div><script>window.__timelines["root"]=gsap.timeline().to("#a",{x:9});</script>`,
    );
    expect(diffSoftReloadableRestore(prev, next)).toEqual({ changedElementIds: [] });
  });
});

function buildLiveIframe(bodyHtml: string) {
  const doc = document.implementation.createHTMLDocument("");
  doc.body.innerHTML = bodyHtml;
  const contentWindow = {
    gsap: { timeline: () => {} },
    __hfForceTimelineRebind: () => {},
    __timelines: {} as Record<string, unknown>,
    __player: { getTime: () => 3, seek: vi.fn() },
    __hfStudioManualEditsApply: vi.fn(),
  };
  return {
    iframe: { contentWindow, contentDocument: doc } as unknown as HTMLIFrameElement,
    contentWindow,
    doc,
  };
}

describe("applyUndoRestoreToPreview", () => {
  const ROOT = "index.html";

  it("soft-applies an attribute/style-only restore: syncs the live element, no full reload", () => {
    const { iframe, contentWindow, doc } = buildLiveIframe(
      `<div id="a" style="translate: 10px 10px" data-hf-path-offset="true">t</div>`,
    );
    const reloadPreview = vi.fn();
    const files = {
      [ROOT]: {
        previous: wrap(
          `<div id="a" style="translate: 10px 10px" data-hf-path-offset="true">t</div>`,
        ),
        restored: wrap(`<div id="a" style="translate: 0px 0px" data-hf-path-offset="true">t</div>`),
      },
    };
    const outcome = applyUndoRestoreToPreview(iframe, ROOT, files, 3, reloadPreview);
    expect(outcome).toBe("soft");
    expect(reloadPreview).not.toHaveBeenCalled();
    // Live element reverted to the restored inline style.
    expect(doc.getElementById("a")!.getAttribute("style")).toBe("translate: 0px 0px");
    // No GSAP script in the restore → the manual-edit reapply runs, playhead held.
    expect(contentWindow.__player.seek).toHaveBeenCalledWith(3);
    expect(contentWindow.__hfStudioManualEditsApply).toHaveBeenCalled();
  });

  it("full-reloads a multi-file restore", () => {
    const { iframe } = buildLiveIframe(`<div id="a">t</div>`);
    const reloadPreview = vi.fn();
    const files = {
      [ROOT]: {
        previous: wrap(`<div id="a" style="x">t</div>`),
        restored: wrap(`<div id="a">t</div>`),
      },
      "scenes/intro.html": { previous: "a", restored: "b" },
    };
    expect(applyUndoRestoreToPreview(iframe, ROOT, files, 3, reloadPreview)).toBe("full");
    expect(reloadPreview).toHaveBeenCalledTimes(1);
  });

  it("full-reloads a structural restore (split/delete undo)", () => {
    const { iframe } = buildLiveIframe(`<div id="a">t</div><div id="a-split">t</div>`);
    const reloadPreview = vi.fn();
    const files = {
      [ROOT]: {
        previous: wrap(`<div id="a">t</div><div id="a-split">t</div>`),
        restored: wrap(`<div id="a">t</div>`),
      },
    };
    expect(applyUndoRestoreToPreview(iframe, ROOT, files, 3, reloadPreview)).toBe("full");
    expect(reloadPreview).toHaveBeenCalledTimes(1);
  });

  it("full-reloads when the restore touches a sub-comp, not the active comp", () => {
    const { iframe } = buildLiveIframe(`<div id="a">t</div>`);
    const reloadPreview = vi.fn();
    const files = { "scenes/intro.html": { previous: "a", restored: "b" } };
    expect(applyUndoRestoreToPreview(iframe, ROOT, files, 3, reloadPreview)).toBe("full");
    expect(reloadPreview).toHaveBeenCalledTimes(1);
  });
});
