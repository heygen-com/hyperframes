// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MutableRefObject } from "react";
import type { DomEditSelection, DomEditTextField } from "../components/editor/domEditing";
import type { ImportedFontAsset } from "../components/editor/fontAssets";
import { StudioSaveHttpError } from "../utils/studioSaveDiagnostics";
import { trackStudioEvent } from "../utils/studioTelemetry";
import { useDomEditCommits } from "./useDomEditCommits";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

vi.mock("../utils/studioTelemetry", () => ({
  trackStudioEvent: vi.fn(),
}));

interface PatchResponseBody {
  ok?: boolean;
  changed?: boolean;
  matched?: boolean;
  content?: string;
}

interface RenderedDomEditCommits {
  hook: ReturnType<typeof useDomEditCommits>;
  showToast: ReturnType<typeof makeShowToast>;
  recordEdit: ReturnType<typeof vi.fn<() => Promise<void>>>;
  cleanup: () => void;
}

interface RenderDomEditCommitsOptions {
  importedFontAssets?: ImportedFontAsset[];
  writeProjectFile?: (path: string, content: string) => Promise<void>;
}

type FetchHandler = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => Promise<Response>;

function makeShowToast() {
  return vi.fn<(message: string, tone?: "error" | "info") => void>();
}

function ensureCssEscape(): void {
  const escape = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  if (typeof globalThis.CSS === "undefined") {
    Object.defineProperty(globalThis, "CSS", {
      value: { escape },
      configurable: true,
    });
    return;
  }
  if (typeof globalThis.CSS.escape !== "function") {
    Object.defineProperty(globalThis.CSS, "escape", {
      value: escape,
      configurable: true,
    });
  }
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolveFn: Deferred<T>["resolve"] | null = null;
  let rejectFn: Deferred<T>["reject"] | null = null;
  const promise = new Promise<T>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  if (!resolveFn || !rejectFn) throw new Error("Expected promise callbacks");
  return { promise, resolve: resolveFn, reject: rejectFn };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function stubPatchFetch(
  patchResponse: PatchResponseBody | Error,
  sourceContent = '<div data-hf-id="hf-card" style="color: red">Card</div>',
) {
  const fetchMock = vi.fn(
    async (
      input: Parameters<typeof fetch>[0],
      _init?: Parameters<typeof fetch>[1],
    ): Promise<Response> => {
      const url = requestUrl(input);
      if (url.includes("/api/projects/p1/files/")) {
        return jsonResponse({ content: sourceContent });
      }
      if (url.includes("/api/projects/p1/file-mutations/patch-element/")) {
        if (patchResponse instanceof Error) throw patchResponse;
        return jsonResponse(patchResponse);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubUnexpectedPersistFetch() {
  const fetchMock = vi.fn(async (): Promise<Response> => {
    throw new Error("persist should not run");
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function flushAsyncWork(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve();
  }
}

function createPreviewElement(
  bodyHtml = '<div data-hf-id="hf-card" style="color: red">Card</div>',
): {
  iframe: HTMLIFrameElement;
  element: HTMLElement;
} {
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const doc = iframe.contentDocument;
  if (!doc) throw new Error("Expected iframe contentDocument");
  doc.body.innerHTML = bodyHtml;
  const element = doc.querySelector('[data-hf-id="hf-card"]');
  if (!(element instanceof HTMLElement)) throw new Error("Expected HTML target element");
  return { iframe, element };
}

function textField(input: {
  key: string;
  value: string;
  source: DomEditTextField["source"];
  tagName?: string;
}): DomEditTextField {
  return {
    key: input.key,
    label: input.key,
    value: input.value,
    tagName: input.tagName ?? "span",
    attributes: [],
    inlineStyles: {},
    computedStyles: {},
    source: input.source,
  };
}

function createSelection(
  element: HTMLElement,
  overrides: Partial<DomEditSelection> = {},
): DomEditSelection {
  const base: DomEditSelection = {
    element,
    label: "Hero title",
    tagName: "div",
    sourceFile: "index.html",
    compositionPath: "index.html",
    isCompositionHost: false,
    isInsideLockedComposition: false,
    boundingBox: { x: 0, y: 0, width: 120, height: 40 },
    textContent: element.textContent,
    dataAttributes: {},
    inlineStyles: { color: "red" },
    computedStyles: {},
    textFields: [],
    capabilities: {
      canSelect: true,
      canEditStyles: true,
      canMove: true,
      canResize: true,
      canApplyManualOffset: true,
      canApplyManualSize: true,
      canApplyManualRotation: true,
    },
    hfId: "hf-card",
    selector: '[data-hf-id="hf-card"]',
    selectorIndex: 0,
  };
  return { ...base, ...overrides };
}

function renderDomEditCommits(
  selection: DomEditSelection,
  iframe: HTMLIFrameElement,
  options: RenderDomEditCommitsOptions = {},
) {
  const captured: { current: ReturnType<typeof useDomEditCommits> | null } = { current: null };
  const showToast = makeShowToast();
  const recordEdit = vi.fn(async () => {});
  const previewIframeRef: MutableRefObject<HTMLIFrameElement | null> = { current: iframe };
  const projectIdRef: MutableRefObject<string | null> = { current: "p1" };
  const domEditSaveTimestampRef: MutableRefObject<number> = { current: 0 };

  function Probe() {
    captured.current = useDomEditCommits({
      activeCompPath: "index.html",
      previewIframeRef,
      showToast,
      queueDomEditSave: async (save) => save(),
      writeProjectFile: options.writeProjectFile ?? (async () => {}),
      domEditSaveTimestampRef,
      editHistory: { recordEdit },
      fileTree: [],
      importedFontAssetsRef: { current: options.importedFontAssets ?? [] },
      projectId: "p1",
      projectIdRef,
      reloadPreview: vi.fn(),
      domEditSelection: selection,
      applyDomSelection: vi.fn(),
      clearDomSelection: vi.fn(),
      refreshDomEditSelectionFromPreview: vi.fn(),
      buildDomSelectionFromTarget: vi.fn(async () => null),
    });
    return null;
  }

  const container = document.createElement("div");
  const root: Root = createRoot(container);
  act(() => {
    root.render(createElement(Probe));
  });

  if (!captured.current) throw new Error("Expected hook result");
  return {
    hook: captured.current,
    showToast,
    recordEdit,
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  } satisfies RenderedDomEditCommits;
}

async function commitStyleAgainst(response: Parameters<typeof stubPatchFetch>[0]) {
  stubPatchFetch(response);
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const { iframe, element } = createPreviewElement();
  const rendered = renderDomEditCommits(createSelection(element), iframe);
  await act(async () => {
    await rendered.hook.handleDomStyleCommit("color", "blue");
  });
  return {
    element,
    rendered,
    warnSpy,
    cleanup: () => {
      warnSpy.mockRestore();
      rendered.cleanup();
    },
  };
}

function renderStyleCommitWithFetch(fetchHandler: FetchHandler) {
  const fetchMock = vi.fn(fetchHandler);
  vi.stubGlobal("fetch", fetchMock);
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const { iframe, element } = createPreviewElement();
  const rendered = renderDomEditCommits(createSelection(element), iframe);
  return {
    element,
    fetchMock,
    rendered,
    warnSpy,
    cleanup: () => {
      warnSpy.mockRestore();
      rendered.cleanup();
    },
  };
}

async function expectRejectedTextStructureEdit(
  commit: (hook: ReturnType<typeof useDomEditCommits>) => Promise<unknown>,
): Promise<void> {
  const fetchMock = stubUnexpectedPersistFetch();
  const { iframe, element } = createPreviewElement(
    '<div data-hf-id="hf-card"><span>First</span><span>Second</span></div>',
  );
  const originalInnerHtml = element.innerHTML;
  const selection = createSelection(element, {
    textFields: [
      textField({ key: "first", value: "First", source: "child" }),
      textField({ key: "second", value: "Second", source: "child" }),
    ],
  });
  const rendered = renderDomEditCommits(selection, iframe);

  try {
    await act(async () => {
      await commit(rendered.hook);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(rendered.showToast).toHaveBeenCalledWith(
      expect.stringContaining("text structure change"),
      "error",
    );
    expect(element.innerHTML).toBe(originalInnerHtml);
    expect(rendered.recordEdit).not.toHaveBeenCalled();
  } finally {
    rendered.cleanup();
  }
}

describe("useDomEditCommits style persist handling", () => {
  beforeEach(() => {
    ensureCssEscape();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("toasts and reverts a style commit when the server cannot resolve the source element", async () => {
    const { element, rendered, cleanup } = await commitStyleAgainst({
      ok: true,
      changed: false,
      matched: false,
    });

    try {
      expect(rendered.showToast).toHaveBeenCalledWith(
        expect.stringMatching(/Couldn't save "Hero title": Couldn't find this element/),
        "error",
      );
      expect(element.style.getPropertyValue("color")).toBe("red");
      expect(trackStudioEvent).toHaveBeenCalledWith(
        "save_skipped_unresolvable",
        expect.objectContaining({ target_source_file: "index.html" }),
      );
    } finally {
      cleanup();
    }
  });

  it("warns without a toast when the server matched the element but reported no change", async () => {
    const { rendered, warnSpy, cleanup } = await commitStyleAgainst({
      ok: true,
      changed: false,
      matched: true,
    });

    try {
      expect(rendered.showToast).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        "[Studio] DOM edit persist no-op",
        expect.objectContaining({ operations: "inline-style:color" }),
      );
    } finally {
      cleanup();
    }
  });

  it("toasts and reverts a style commit when the patch request rejects", async () => {
    const { element, rendered, cleanup } = await commitStyleAgainst(new Error("network down"));

    try {
      expect(rendered.showToast).toHaveBeenCalledWith(
        'Couldn\'t save "Hero title": network down',
        "error",
      );
      expect(element.style.getPropertyValue("color")).toBe("red");
    } finally {
      cleanup();
    }
  });

  it("keeps the optimistic style and records history when the patch succeeds", async () => {
    const { element, rendered, cleanup } = await commitStyleAgainst({
      ok: true,
      changed: true,
      matched: true,
      content: '<div data-hf-id="hf-card" style="color: blue">Card</div>',
    });

    try {
      expect(rendered.showToast).not.toHaveBeenCalled();
      expect(element.style.getPropertyValue("color")).toBe("blue");
      expect(rendered.recordEdit).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  it("keeps a newer style value when an older overlapping commit later fails", async () => {
    const firstPatch = createDeferred<Response>();
    const secondPatch = createDeferred<Response>();
    let patchCount = 0;
    const { element, rendered, cleanup } = renderStyleCommitWithFetch(async (input) => {
      const url = requestUrl(input);
      if (url.includes("/api/projects/p1/files/")) {
        return jsonResponse({
          content: '<div data-hf-id="hf-card" style="color: red">Card</div>',
        });
      }
      if (url.includes("/api/projects/p1/file-mutations/patch-element/")) {
        patchCount += 1;
        return patchCount === 1 ? firstPatch.promise : secondPatch.promise;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    try {
      const firstCommit = rendered.hook.handleDomStyleCommit("color", "blue");
      await flushAsyncWork();
      expect(patchCount).toBe(1);

      const secondCommit = rendered.hook.handleDomStyleCommit("color", "green");
      await flushAsyncWork();
      expect(patchCount).toBe(2);

      secondPatch.resolve(
        jsonResponse({
          ok: true,
          changed: true,
          matched: true,
          content: '<div data-hf-id="hf-card" style="color: green">Card</div>',
        }),
      );
      await secondCommit;
      expect(element.style.getPropertyValue("color")).toBe("green");

      firstPatch.reject(new Error("server rejected blue"));
      await firstCommit;

      expect(element.style.getPropertyValue("color")).toBe("green");
    } finally {
      cleanup();
    }
  });

  it("toasts read failures from the source file fetch", async () => {
    const { rendered, cleanup } = renderStyleCommitWithFetch(async (input) => {
      const url = requestUrl(input);
      if (url.includes("/api/projects/p1/files/")) {
        return new Response("read failed", { status: 503 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    try {
      await act(async () => {
        await rendered.hook.handleDomStyleCommit("color", "blue");
      });

      expect(rendered.showToast).toHaveBeenCalledWith(
        expect.stringContaining("Failed to read index.html (503)"),
        "error",
      );
    } finally {
      cleanup();
    }
  });

  it("toasts prepareContent write failures", async () => {
    stubPatchFetch(
      {
        ok: true,
        changed: true,
        matched: true,
        content:
          '<!doctype html><html><head></head><body><div data-hf-id="hf-card">Card</div></body></html>',
      },
      '<!doctype html><html><head></head><body><div data-hf-id="hf-card">Card</div></body></html>',
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { iframe, element } = createPreviewElement();
    const selection = createSelection(element, {
      textFields: [textField({ key: "self", value: "Card", source: "self", tagName: "div" })],
    });
    const rendered = renderDomEditCommits(createSelection(element), iframe, {
      writeProjectFile: async () => {
        throw new StudioSaveHttpError("Failed to save index.html (500)", 500);
      },
    });

    try {
      await act(async () => {
        await rendered.hook.commitDomTextFields(
          selection,
          [textField({ key: "self", value: "Card", source: "self", tagName: "div" })],
          {
            importedFont: {
              family: "Imported",
              path: "fonts/Imported.woff2",
              url: "/api/projects/p1/preview/fonts/Imported.woff2",
            },
          },
        );
      });

      expect(rendered.showToast).toHaveBeenCalledWith(
        expect.stringContaining("Failed to save index.html (500)"),
        "error",
      );
    } finally {
      warnSpy.mockRestore();
      rendered.cleanup();
    }
  });

  it("keeps the unsafe-value path to one toast", async () => {
    stubPatchFetch({
      ok: true,
      changed: true,
      matched: true,
      content: '<div data-hf-id="hf-card" style="color: blue">Card</div>',
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { iframe, element } = createPreviewElement();
    const rendered = renderDomEditCommits(createSelection(element, { id: null }), iframe);

    try {
      await act(async () => {
        await rendered.hook.handleDomStyleCommit("color", "blue");
      });

      expect(rendered.showToast).toHaveBeenCalledTimes(1);
      expect(rendered.showToast).toHaveBeenCalledWith(
        "Couldn't save edit because it contains invalid layout values",
        "error",
      );
    } finally {
      warnSpy.mockRestore();
      rendered.cleanup();
    }
  });

  it("refuses added child text fields without persisting serialized markup", async () => {
    await expectRejectedTextStructureEdit((hook) => hook.handleDomAddTextField("first"));
  });

  it("refuses removed child text fields without persisting serialized markup", async () => {
    await expectRejectedTextStructureEdit((hook) => hook.handleDomRemoveTextField("first"));
  });

  it("keeps single self text commits on the text-content path", async () => {
    stubPatchFetch({
      ok: true,
      changed: true,
      matched: true,
      content: '<div data-hf-id="hf-card">A &lt; B</div>',
    });
    const { iframe, element } = createPreviewElement('<div data-hf-id="hf-card">Card</div>');
    const selection = createSelection(element, {
      textFields: [textField({ key: "self", value: "Card", source: "self", tagName: "div" })],
    });
    const rendered = renderDomEditCommits(selection, iframe);

    try {
      await act(async () => {
        await rendered.hook.handleDomTextCommit("A < B", "self");
      });

      expect(rendered.showToast).not.toHaveBeenCalled();
      expect(rendered.recordEdit).toHaveBeenCalledTimes(1);
      expect(element.textContent).toBe("A < B");
    } finally {
      rendered.cleanup();
    }
  });
});
