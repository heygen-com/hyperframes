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
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("expected iframe document");
    doc.body.innerHTML = '<div id="card">Original</div>';
    const element = doc.getElementById("card");
    const HTMLElementCtor = doc.defaultView?.HTMLElement;
    if (!HTMLElementCtor || !(element instanceof HTMLElementCtor)) {
      throw new Error("expected preview element");
    }
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const selection = selectionFor(element);
    const stalePersist = createDeferred<void>();
    const persistDomEditOperations = vi
      .fn()
      .mockImplementationOnce(() => stalePersist.promise)
      .mockResolvedValueOnce(undefined);
    const hook = renderTextCommitHook({
      activeCompPath: "index.html",
      previewIframeRef: { current: iframe },
      showToast: vi.fn(),
      domEditSelection: selection,
      applyDomSelection: vi.fn(),
      refreshDomEditSelectionFromPreview: vi.fn(),
      buildDomSelectionFromTarget: vi.fn(async () => null),
      persistDomEditOperations,
      resolveImportedFontAsset: () => null,
    });

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
});
