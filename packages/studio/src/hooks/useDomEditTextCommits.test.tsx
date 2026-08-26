// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DomEditSelection, DomEditTextField } from "../components/editor/domEditing";
import { mountReactHarness } from "./domSelectionTestHarness";
import { useDomEditTextCommits, type UseDomEditTextCommitsParams } from "./useDomEditTextCommits";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve: Deferred<T>["resolve"] | undefined;
  let reject: Deferred<T>["reject"] | undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  if (!resolve || !reject) throw new Error("deferred callbacks were not initialized");
  return { promise, resolve, reject };
}

function textField(value: string): DomEditTextField {
  return {
    key: "self",
    label: "Text",
    value,
    tagName: "div",
    attributes: [],
    inlineStyles: {},
    computedStyles: {},
    source: "self",
  };
}

function selectionFor(element: HTMLElement): DomEditSelection {
  return {
    id: element.id,
    element,
    label: "Card",
    tagName: "div",
    sourceFile: "index.html",
    compositionPath: "index.html",
    isCompositionHost: false,
    isInsideLockedComposition: false,
    boundingBox: { x: 0, y: 0, width: 100, height: 100 },
    textContent: element.textContent,
    dataAttributes: {},
    inlineStyles: {},
    computedStyles: {},
    textFields: [textField(element.textContent ?? "")],
    capabilities: {
      canSelect: true,
      canEditStyles: true,
      canCrop: true,
      canMove: true,
      canResize: true,
      canApplyManualOffset: true,
      canApplyManualSize: true,
      canApplyManualRotation: true,
    },
  };
}

/** A preview element inside a real iframe, which is where Studio's chrome expects to find it. */
function previewElement(
  html: string,
  id: string,
): { iframe: HTMLIFrameElement; element: HTMLElement } {
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const doc = iframe.contentDocument;
  if (!doc) throw new Error("expected iframe document");
  doc.body.innerHTML = html;
  const element = doc.getElementById(id);
  const HTMLElementCtor = doc.defaultView?.HTMLElement;
  if (!HTMLElementCtor || !(element instanceof HTMLElementCtor)) {
    throw new Error("expected preview element");
  }
  return { iframe, element };
}

/** Hook params with nothing selected and a writer that succeeds; override what the test is about. */
function commitParams(
  overrides: Partial<UseDomEditTextCommitsParams> = {},
): UseDomEditTextCommitsParams {
  return {
    activeCompPath: "index.html",
    previewIframeRef: { current: null },
    showToast: vi.fn(),
    domEditSelection: null,
    applyDomSelection: vi.fn(),
    refreshDomEditSelectionFromPreview: vi.fn(),
    buildDomSelectionFromTarget: vi.fn(async () => null),
    persistDomEditOperations: vi.fn().mockResolvedValue(undefined),
    resolveImportedFontAsset: () => null,
    ...overrides,
  };
}

let cleanup: (() => void) | null = null;

function renderTextCommitHook(params: UseDomEditTextCommitsParams) {
  const captured: { hook: ReturnType<typeof useDomEditTextCommits> | null } = { hook: null };
  function TextCommitProbe() {
    captured.hook = useDomEditTextCommits(params);
    return null;
  }
  const root = mountReactHarness(<TextCommitProbe />);
  cleanup = () => act(() => root.unmount());
  if (!captured.hook) throw new Error("hook did not initialize");
  return captured.hook;
}

afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("useDomEditTextCommits", () => {
  it("does not let a stale failed fields commit revert newer text", async () => {
    const { iframe, element } = previewElement("<div id='card'>Original</div>", "card");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const selection = selectionFor(element);
    const stalePersist = createDeferred<void>();
    const persistDomEditOperations = vi
      .fn()
      .mockImplementationOnce(() => stalePersist.promise)
      .mockResolvedValueOnce(undefined);
    const hook = renderTextCommitHook(
      commitParams({
        previewIframeRef: { current: iframe },
        domEditSelection: selection,
        persistDomEditOperations,
      }),
    );

    let staleCommit: Promise<void> | undefined;
    act(() => {
      staleCommit = hook.commitDomTextFields(selection, [textField("Stale")]);
    });
    await act(async () => {
      await hook.commitDomTextFields(selection, [textField("Newest")]);
    });
    stalePersist.reject(new Error("stale request failed"));
    await act(async () => {
      await staleCommit;
    });

    expect(element.innerHTML).toBe("Newest");
  });

  it("reports persist failure from a style commit instead of resolving silently", async () => {
    const { iframe, element } = previewElement("<div id='card'>Original</div>", "card");
    const selection = selectionFor(element);
    const showToast = vi.fn();
    const hook = renderTextCommitHook(
      commitParams({
        previewIframeRef: { current: iframe },
        showToast,
        domEditSelection: selection,
        persistDomEditOperations: vi.fn().mockRejectedValue(new Error("server said no")),
      }),
    );

    let outcome: unknown;
    await act(async () => {
      outcome = await hook.handleDomStyleCommit("color", "red");
    });

    expect(outcome).toEqual({ ok: false, reason: "persist-failed" });
    // The human-facing behaviour must be unchanged: still toasts, still reverts.
    expect(showToast).toHaveBeenCalled();
    expect(element.style.getPropertyValue("color")).toBe("");
  });

  it("reports a successful style commit", async () => {
    const { iframe, element } = previewElement("<div id='card'>Original</div>", "card");
    const selection = selectionFor(element);
    const hook = renderTextCommitHook(
      commitParams({ previewIframeRef: { current: iframe }, domEditSelection: selection }),
    );

    let outcome: unknown;
    await act(async () => {
      outcome = await hook.handleDomStyleCommit("color", "red");
    });

    expect(outcome).toEqual({ ok: true });
  });

  it("declines a style commit with no selection, without reaching the writer", async () => {
    const persistDomEditOperations = vi.fn().mockResolvedValue(undefined);
    const hook = renderTextCommitHook(
      commitParams({
        domEditSelection: null,
        persistDomEditOperations,
      }),
    );

    let outcome: unknown;
    await act(async () => {
      outcome = await hook.handleDomStyleCommit("color", "red");
    });

    expect(outcome).toEqual({ ok: false, reason: "no-selection" });
    expect(persistDomEditOperations).not.toHaveBeenCalled();
  });

  it("declines a style commit for a manual-geometry property", async () => {
    const persistDomEditOperations = vi.fn().mockResolvedValue(undefined);
    const { element } = previewElement("<div id='card'>Original</div>", "card");
    const hook = renderTextCommitHook(
      commitParams({
        domEditSelection: selectionFor(element),
        persistDomEditOperations,
      }),
    );

    let outcome: unknown;
    await act(async () => {
      // `left` is a manual-geometry property the style path deliberately refuses.
      outcome = await hook.handleDomStyleCommit("left", "10px");
    });

    expect(outcome).toEqual({ ok: false, reason: "geometry-property" });
    expect(persistDomEditOperations).not.toHaveBeenCalled();
  });

  it("declines a style commit when the selection cannot edit styles", async () => {
    const persistDomEditOperations = vi.fn().mockResolvedValue(undefined);
    const { element } = previewElement("<div id='card'>Original</div>", "card");
    const locked = selectionFor(element);
    locked.capabilities = { ...locked.capabilities, canEditStyles: false };
    const hook = renderTextCommitHook(
      commitParams({
        domEditSelection: locked,
        persistDomEditOperations,
      }),
    );

    let outcome: unknown;
    await act(async () => {
      outcome = await hook.handleDomStyleCommit("color", "red");
    });

    expect(outcome).toEqual({ ok: false, reason: "styles-not-editable" });
    expect(persistDomEditOperations).not.toHaveBeenCalled();
  });

  it("reports persist failure from a text commit instead of resolving silently", async () => {
    const { iframe, element } = previewElement("<div id='card'>Original</div>", "card");
    const selection = selectionFor(element);
    const hook = renderTextCommitHook(
      commitParams({
        previewIframeRef: { current: iframe },
        domEditSelection: selection,
        persistDomEditOperations: vi.fn().mockRejectedValue(new Error("server said no")),
      }),
    );

    let outcome: unknown;
    await act(async () => {
      outcome = await hook.handleDomTextCommit("Updated");
    });

    expect(outcome).toEqual({ ok: false, reason: "persist-failed" });
    expect(element.innerHTML).toBe("Original");
  });

  it("reports a text commit declined for an unselected target", async () => {
    const persistDomEditOperations = vi.fn().mockResolvedValue(undefined);
    const hook = renderTextCommitHook(commitParams({ persistDomEditOperations }));

    let outcome: unknown;
    await act(async () => {
      outcome = await hook.handleDomTextCommit("Updated");
    });

    expect(outcome).toEqual({ ok: false, reason: "no-selection" });
    expect(persistDomEditOperations).not.toHaveBeenCalled();
  });
});
