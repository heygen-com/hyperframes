// fallow-ignore-file code-duplication
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MutableRefObject } from "react";
import type { DomEditSelection, DomEditTextField } from "../components/editor/domEditing";
import type { ImportedFontAsset } from "../components/editor/fontAssets";
import { buildStrokeWidthStyleUpdates } from "../components/editor/propertyPanelHelpers";
import { usePlayerStore } from "../player";
import { createDomEditSaveQueue } from "../utils/domEditSaveQueue";
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
  reloadPreview: ReturnType<typeof vi.fn>;
  refreshDomEditSelectionFromPreview: (selection: DomEditSelection) => void;
  cleanup: () => void;
}

interface RenderDomEditCommitsOptions {
  importedFontAssets?: ImportedFontAsset[];
  queueDomEditSave?: <T>(save: () => Promise<T>) => Promise<T>;
  refreshDomEditSelectionFromPreview?: (selection: DomEditSelection) => void;
  writeProjectFile?: (path: string, content: string, expectedContent?: string) => Promise<void>;
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

interface CapturedPatchOperation {
  type: string;
  property: string;
  value: unknown;
  childSelector: unknown;
  childIndex: unknown;
}

function isPatchOperationLike(value: unknown): value is { type: string; property: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string" &&
    "property" in value &&
    typeof value.property === "string"
  );
}

function requestOperations(init: Parameters<typeof fetch>[1]): CapturedPatchOperation[] {
  const body: unknown = JSON.parse(String(init?.body));
  if (typeof body !== "object" || body === null || !("operations" in body)) {
    throw new Error("Expected patch operations");
  }
  if (!Array.isArray(body.operations)) throw new Error("Expected patch operations");
  return body.operations.map((operation) => {
    if (!isPatchOperationLike(operation)) throw new Error("Expected patch operation");
    return {
      type: operation.type,
      property: operation.property,
      value: "value" in operation ? operation.value : undefined,
      childSelector: "childSelector" in operation ? operation.childSelector : undefined,
      childIndex: "childIndex" in operation ? operation.childIndex : undefined,
    };
  });
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
  sourceChildIndex?: number;
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
    sourceChildIndex: input.sourceChildIndex,
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
      canCrop: true,
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
  const reloadPreview = vi.fn();
  const refreshDomEditSelectionFromPreview = options.refreshDomEditSelectionFromPreview ?? vi.fn();

  function Probe() {
    captured.current = useDomEditCommits({
      activeCompPath: "index.html",
      previewIframeRef,
      showToast,
      queueDomEditSave: options.queueDomEditSave ?? (async (save) => save()),
      writeProjectFile: options.writeProjectFile ?? (async () => {}),
      domEditSaveTimestampRef,
      editHistory: { recordEdit },
      fileTree: [],
      importedFontAssetsRef: { current: options.importedFontAssets ?? [] },
      projectId: "p1",
      projectIdRef,
      reloadPreview,
      domEditSelection: selection,
      applyDomSelection: vi.fn(),
      clearDomSelection: vi.fn(),
      refreshDomEditSelectionFromPreview,
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
    reloadPreview,
    refreshDomEditSelectionFromPreview,
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  } satisfies RenderedDomEditCommits;
}

describe("useDomEditCommits z-index reorder persistence", () => {
  beforeEach(() => {
    ensureCssEscape();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("persists an N-element reorder with one batch POST, one undo entry, and NO iframe reload", async () => {
    const original =
      '<div id="a" style="z-index: 1"></div><div id="b" style="z-index: 2"></div><div id="c" style="z-index: 3"></div>';
    const after =
      '<div id="a" style="z-index: 3"></div><div id="b" style="z-index: 2"></div><div id="c" style="z-index: 1"></div>';
    const fetchMock = vi.fn(
      async (
        input: Parameters<typeof fetch>[0],
        _init?: Parameters<typeof fetch>[1],
      ): Promise<Response> => {
        const url = requestUrl(input);
        if (url.endsWith("/file-mutations/patch-element-batches")) {
          return jsonResponse({
            durable: true,
            files: [
              {
                sourceFile: "index.html",
                changed: true,
                matched: [true, true, true],
                before: original,
                after,
              },
            ],
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const { iframe, element } = createPreviewElement(
      '<div data-hf-id="hf-card"></div><div id="b"></div><div id="c"></div>',
    );
    element.id = "a";
    const elements = [
      element,
      iframe.contentDocument!.getElementById("b")!,
      iframe.contentDocument!.getElementById("c")!,
    ];
    const rendered = renderDomEditCommits(createSelection(element), iframe);

    try {
      await act(async () => {
        await rendered.hook.handleDomZIndexReorderCommit(
          elements.map((item, index) => ({
            element: item,
            zIndex: 3 - index,
            id: item.id,
            sourceFile: "index.html",
          })),
          "z-reorder:test",
        );
      });

      const batchPosts = fetchMock.mock.calls.filter(([input]) =>
        requestUrl(input).endsWith("/file-mutations/patch-element-batches"),
      );
      const singlePosts = fetchMock.mock.calls.filter(([input]) =>
        requestUrl(input).includes("/file-mutations/patch-elements-batch/"),
      );
      expect(batchPosts).toHaveLength(1);
      expect(singlePosts).toHaveLength(0);
      expect(JSON.parse(String(batchPosts[0]?.[1]?.body))).toEqual({
        batches: [
          {
            sourceFile: "index.html",
            patches: expect.arrayContaining([
              expect.objectContaining({ target: expect.objectContaining({ id: "a" }) }),
              expect.objectContaining({ target: expect.objectContaining({ id: "b" }) }),
              expect.objectContaining({ target: expect.objectContaining({ id: "c" }) }),
            ]),
          },
        ],
      });
      expect(rendered.recordEdit).toHaveBeenCalledTimes(1);
      expect(rendered.recordEdit).toHaveBeenCalledWith({
        label: "Reorder layers",
        kind: "manual",
        coalesceKey: "z-reorder:test",
        // Unbounded per-gesture fold window (keys are unique per gesture):
        // the z entry and its mirror/lane counterpart fold across the server
        // round-trip that separates them.
        coalesceMs: Number.POSITIVE_INFINITY,
        files: { "index.html": { before: original, after } },
      });
      // FIX: a z-only reorder must NOT remount the preview iframe ("the blink").
      // The live DOM + store already hold the final state and the server matched
      // every style-only patch, so the reload is provably redundant.
      expect(rendered.reloadPreview).not.toHaveBeenCalled();
    } finally {
      rendered.cleanup();
    }
  });

  it("falls back to reloading when the server response omits matched[]", async () => {
    // Without a matched[] confirmation the persist can't be proven in sync with
    // the live DOM — the skip-reload path must not engage.
    const original = '<div id="a" style="z-index: 1"></div>';
    const after = '<div id="a" style="z-index: 2"></div>';
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
      const url = requestUrl(input);
      if (url.endsWith("/file-mutations/patch-element-batches")) {
        return jsonResponse({
          durable: true,
          files: [{ sourceFile: "index.html", changed: true, before: original, after }],
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { iframe, element } = createPreviewElement();
    element.id = "a";
    const rendered = renderDomEditCommits(createSelection(element), iframe);

    try {
      await act(async () => {
        await rendered.hook.handleDomZIndexReorderCommit([
          { element, zIndex: 2, id: "a", sourceFile: "index.html" },
        ]);
      });

      expect(rendered.recordEdit).toHaveBeenCalledTimes(1);
      expect(rendered.reloadPreview).toHaveBeenCalledTimes(1);
    } finally {
      rendered.cleanup();
    }
  });

  it("warns and reports telemetry for unmatched batch patches without throwing", async () => {
    // The server reports per-patch matched[]: #b was not found in the source,
    // so it atomically refuses the whole multi-file gesture. The reload
    // reconverges the preview with disk while the lifecycle owner rolls back
    // both optimistic writes.
    const original = '<div id="a" style="z-index: 1"></div>';
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
      const url = requestUrl(input);
      if (url.endsWith("/file-mutations/patch-element-batches")) {
        return jsonResponse({
          durable: false,
          files: [
            {
              sourceFile: "index.html",
              changed: false,
              matched: [true, false],
              before: original,
              after: original,
            },
          ],
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { iframe, element } = createPreviewElement(
      '<div data-hf-id="hf-card"></div><div id="b"></div>',
    );
    element.id = "a";
    const second = iframe.contentDocument!.getElementById("b")!;
    const rendered = renderDomEditCommits(createSelection(element), iframe);

    try {
      await act(async () => {
        await rendered.hook.handleDomZIndexReorderCommit([
          { element, zIndex: 2, id: "a", sourceFile: "index.html" },
          { element: second, zIndex: 1, id: "b", sourceFile: "index.html" },
        ]);
      });

      // No throw: incomplete durability rolls back both optimistic writes.
      expect(element.style.zIndex).toBe("");
      expect(second.style.zIndex).toBe("");
      expect(rendered.recordEdit).not.toHaveBeenCalled();
      expect(rendered.reloadPreview).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("could not match 1 patch target(s) in index.html"),
        "b",
      );
      expect(trackStudioEvent).toHaveBeenCalledWith(
        "save_failure",
        expect.objectContaining({
          mutation_type: "z-reorder-unmatched",
          file_path: "index.html",
          error_message: expect.stringContaining("b"),
        }),
      );
    } finally {
      warnSpy.mockRestore();
      rendered.cleanup();
    }
  });

  it("uses one atomic request and rolls back every file when one target is unmatched", async () => {
    const indexOriginal = '<div id="a" style="z-index: 4"></div>';
    const sceneOriginal = '<div id="b" style="z-index: 5"></div>';
    const fetchMock = vi.fn(
      async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ): Promise<Response> => {
        const url = requestUrl(input);
        if (url.endsWith("/file-mutations/patch-element-batches")) {
          expect(JSON.parse(String(init?.body))).toEqual({
            batches: [
              expect.objectContaining({ sourceFile: "index.html" }),
              expect.objectContaining({ sourceFile: "scene.html" }),
            ],
          });
          return jsonResponse({
            durable: false,
            files: [
              {
                sourceFile: "index.html",
                changed: false,
                matched: [true],
                before: indexOriginal,
                after: indexOriginal,
              },
              {
                sourceFile: "scene.html",
                changed: false,
                matched: [false],
                before: sceneOriginal,
                after: sceneOriginal,
              },
            ],
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { iframe, element } = createPreviewElement(
      '<div data-hf-id="hf-card" style="z-index: 4"></div><div id="b" style="z-index: 5"></div>',
    );
    element.id = "a";
    const second = iframe.contentDocument!.getElementById("b")!;
    const rendered = renderDomEditCommits(createSelection(element), iframe);

    try {
      let result:
        | Awaited<ReturnType<typeof rendered.hook.handleDomZIndexReorderCommit>>
        | undefined;
      await act(async () => {
        result = await rendered.hook.handleDomZIndexReorderCommit([
          { element, zIndex: 8, id: "a", sourceFile: "index.html" },
          { element: second, zIndex: 9, id: "b", sourceFile: "scene.html" },
        ]);
      });

      expect(result).toEqual({ durable: false, allMatched: false, changed: false });
      expect(element.style.zIndex).toBe("4");
      expect(second.style.zIndex).toBe("5");
      expect(rendered.recordEdit).not.toHaveBeenCalled();
      expect(rendered.reloadPreview).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
      rendered.cleanup();
    }
  });

  it("reloads and reports non-durable when an unmatched batch changes no bytes", async () => {
    const original = '<div id="a" style="z-index: 1"></div>';
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
      const url = requestUrl(input);
      if (url.endsWith("/file-mutations/patch-element-batches")) {
        return jsonResponse({
          durable: false,
          files: [
            {
              sourceFile: "index.html",
              changed: false,
              matched: [false],
              before: original,
              after: original,
            },
          ],
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { iframe, element } = createPreviewElement();
    element.id = "a";
    const rendered = renderDomEditCommits(createSelection(element), iframe);

    try {
      let result:
        | Awaited<ReturnType<typeof rendered.hook.handleDomZIndexReorderCommit>>
        | undefined;
      await act(async () => {
        result = await rendered.hook.handleDomZIndexReorderCommit([
          { element, zIndex: 2, id: "missing", sourceFile: "index.html" },
        ]);
      });

      expect(result).toEqual({ durable: false, allMatched: false, changed: false });
      expect(element.style.zIndex).toBe("");
      expect(rendered.recordEdit).not.toHaveBeenCalled();
      expect(rendered.reloadPreview).toHaveBeenCalledTimes(1);
    } finally {
      rendered.cleanup();
    }
  });

  it("rolls back and reloads after a rejected batch POST", async () => {
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
      const url = requestUrl(input);
      if (url.endsWith("/file-mutations/patch-element-batches")) {
        return jsonResponse({ error: "batch rejected" }, 500);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const writeProjectFile = vi.fn(async () => {});
    const { iframe, element } = createPreviewElement(
      '<div data-hf-id="hf-card" style="z-index: 7"></div><div id="b"></div>',
    );
    element.id = "a";
    const second = iframe.contentDocument!.getElementById("b")!;
    usePlayerStore.getState().setElements([
      { id: "a", tag: "div", start: 0, duration: 1, track: 0, zIndex: 7, hasExplicitZIndex: true },
      { id: "b", tag: "div", start: 0, duration: 1, track: 1, zIndex: 0, hasExplicitZIndex: false },
    ]);
    const rendered = renderDomEditCommits(createSelection(element), iframe, { writeProjectFile });

    try {
      let rejection: unknown;
      await act(async () => {
        try {
          await rendered.hook.handleDomZIndexReorderCommit([
            { element, zIndex: 2, id: "a", sourceFile: "index.html", key: "a" },
            { element: second, zIndex: 1, id: "b", sourceFile: "index.html", key: "b" },
          ]);
        } catch (error) {
          rejection = error;
        }
      });

      expect(rejection).toBeInstanceOf(Error);
      expect((rejection as Error).message).toContain("batch rejected");
      expect(element.style.zIndex).toBe("7");
      expect(second.style.zIndex).toBe("");
      expect(
        usePlayerStore
          .getState()
          .elements.map(({ zIndex, hasExplicitZIndex }) => ({ zIndex, hasExplicitZIndex })),
      ).toEqual([
        { zIndex: 7, hasExplicitZIndex: true },
        { zIndex: 0, hasExplicitZIndex: false },
      ]);
      expect(writeProjectFile).not.toHaveBeenCalled();
      expect(rendered.recordEdit).not.toHaveBeenCalled();
      expect(rendered.reloadPreview).toHaveBeenCalledTimes(1);
      expect(
        fetchMock.mock.calls.filter(([input]) =>
          requestUrl(input).endsWith("/file-mutations/patch-element-batches"),
        ),
      ).toHaveLength(1);
    } finally {
      rendered.cleanup();
    }
  });

  it("reloads after the server commits but the aggregate response is lost", async () => {
    const original = '<div data-hf-id="hf-card" id="a" style="z-index: 7"></div>';
    const after = '<div data-hf-id="hf-card" id="a" style="z-index: 2"></div>';
    let diskContent = original;
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
      const url = requestUrl(input);
      if (url.endsWith("/file-mutations/patch-element-batches")) {
        diskContent = after;
        throw new TypeError("connection reset after commit");
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { iframe, element } = createPreviewElement(original);
    usePlayerStore.getState().setElements([
      {
        id: "a",
        tag: "div",
        start: 0,
        duration: 1,
        track: 0,
        zIndex: 7,
        hasExplicitZIndex: true,
      },
    ]);
    const rendered = renderDomEditCommits(createSelection(element), iframe);

    try {
      let rejection: unknown;
      await act(async () => {
        try {
          await rendered.hook.handleDomZIndexReorderCommit([
            { element, zIndex: 2, id: "a", sourceFile: "index.html", key: "a" },
          ]);
        } catch (error) {
          rejection = error;
        }
      });

      expect(rejection).toBeInstanceOf(Error);
      expect((rejection as Error).message).toContain("connection reset after commit");
      expect(diskContent).toBe(after);
      expect(element.style.zIndex).toBe("7");
      expect(usePlayerStore.getState().elements[0]).toMatchObject({
        zIndex: 7,
        hasExplicitZIndex: true,
      });
      expect(rendered.recordEdit).not.toHaveBeenCalled();
      expect(rendered.reloadPreview).toHaveBeenCalledTimes(1);
      expect(
        fetchMock.mock.calls.filter(([input]) =>
          requestUrl(input).endsWith("/file-mutations/patch-element-batches"),
        ),
      ).toHaveLength(1);
    } finally {
      rendered.cleanup();
    }
  });

  it.each([
    [
      "changed=false with different snapshots",
      {
        durable: true,
        files: [
          {
            sourceFile: "index.html",
            changed: false,
            matched: [true],
            before: '<div id="a" style="z-index: 1"></div>',
            after: '<div id="a" style="z-index: 2"></div>',
          },
        ],
      },
    ],
    [
      "changed=true with identical snapshots",
      {
        durable: true,
        files: [
          {
            sourceFile: "index.html",
            changed: true,
            matched: [true],
            before: '<div id="a" style="z-index: 1"></div>',
            after: '<div id="a" style="z-index: 1"></div>',
          },
        ],
      },
    ],
    [
      "durable=false with a changed file",
      {
        durable: false,
        files: [
          {
            sourceFile: "index.html",
            changed: true,
            matched: [true],
            before: '<div id="a" style="z-index: 1"></div>',
            after: '<div id="a" style="z-index: 2"></div>',
          },
        ],
      },
    ],
  ])("rejects and reloads for malformed 200 response: %s", async (_label, responseBody) => {
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
      const url = requestUrl(input);
      if (url.endsWith("/file-mutations/patch-element-batches")) {
        return jsonResponse(responseBody);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { iframe, element } = createPreviewElement();
    element.id = "a";
    const rendered = renderDomEditCommits(createSelection(element), iframe);

    try {
      let rejection: unknown;
      await act(async () => {
        try {
          await rendered.hook.handleDomZIndexReorderCommit([
            { element, zIndex: 2, id: "a", sourceFile: "index.html", key: "a" },
          ]);
        } catch (error) {
          rejection = error;
        }
      });

      expect(rejection).toBeInstanceOf(Error);
      expect((rejection as Error).message).toBe("Invalid atomic element patch response");
      expect(rendered.recordEdit).not.toHaveBeenCalled();
      expect(rendered.reloadPreview).toHaveBeenCalledTimes(1);
      expect(
        fetchMock.mock.calls.filter(([input]) =>
          requestUrl(input).endsWith("/file-mutations/patch-element-batches"),
        ),
      ).toHaveLength(1);
    } finally {
      rendered.cleanup();
    }
  });
});

async function commitStyleAgainst(
  response: Parameters<typeof stubPatchFetch>[0],
  options: RenderDomEditCommitsOptions = {},
) {
  stubPatchFetch(response);
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const { iframe, element } = createPreviewElement();
  const rendered = renderDomEditCommits(createSelection(element), iframe, options);
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

function renderStyleCommitWithFetch(
  fetchHandler: FetchHandler,
  options: RenderDomEditCommitsOptions = {},
) {
  const fetchMock = vi.fn(fetchHandler);
  vi.stubGlobal("fetch", fetchMock);
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const { iframe, element } = createPreviewElement();
  const rendered = renderDomEditCommits(createSelection(element), iframe, options);
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

function renderWithBlockedFirstSave(
  bodyHtml = '<div data-hf-id="hf-card" style="color: red">Card</div>',
  selectionOverrides: Partial<DomEditSelection> = {},
) {
  const firstSave = createDeferred<void>();
  const firstSaveStarted = createDeferred<void>();
  const startedOperations: CapturedPatchOperation[][] = [];
  const persistedState = new Map<string, string | null>();
  let persistReadCount = 0;
  const saveQueue = createDomEditSaveQueue();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = requestUrl(input);
      if (url.includes("/api/projects/p1/files/")) {
        persistReadCount += 1;
        return jsonResponse({ content: bodyHtml });
      }
      if (url.includes("/api/projects/p1/file-mutations/patch-element/")) {
        const operations = requestOperations(init);
        startedOperations.push(operations);
        if (startedOperations.length === 1) {
          firstSaveStarted.resolve(undefined);
          await firstSave.promise;
        }
        for (const operation of operations) {
          if (typeof operation.value !== "string" && operation.value !== null) {
            throw new Error("Expected persisted patch value");
          }
          persistedState.set(operation.property, operation.value);
        }
        return jsonResponse({ ok: true, changed: true, matched: true, content: "" });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }),
  );
  const { iframe, element } = createPreviewElement(bodyHtml);
  const selection = createSelection(element, selectionOverrides);
  const rendered = renderDomEditCommits(selection, iframe, {
    queueDomEditSave: saveQueue.enqueue,
  });
  return {
    element,
    selection,
    rendered,
    startedOperations,
    persistedState,
    firstSaveStarted: firstSaveStarted.promise,
    getPersistReadCount: () => persistReadCount,
    releaseFirstSave: () => firstSave.resolve(undefined),
    cleanup: () => {
      firstSave.resolve(undefined);
      saveQueue.destroy();
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
    const saveQueue = createDomEditSaveQueue();
    const { element, rendered, cleanup } = await commitStyleAgainst(new Error("network down"), {
      queueDomEditSave: saveQueue.enqueue,
    });

    try {
      expect(rendered.showToast).toHaveBeenCalledWith(
        'Couldn\'t save "Hero title": network down',
        "error",
      );
      expect(element.style.getPropertyValue("color")).toBe("red");
    } finally {
      saveQueue.destroy();
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

  it("persists overlapping style commits in issue order", async () => {
    const harness = renderWithBlockedFirstSave();

    try {
      const firstCommit = harness.rendered.hook.handleDomStyleCommit("color", "blue");
      await harness.firstSaveStarted;
      const secondCommit = harness.rendered.hook.handleDomStyleCommit("color", "green");

      expect(harness.getPersistReadCount()).toBe(1);

      harness.releaseFirstSave();
      await Promise.all([firstCommit, secondCommit]);

      expect(harness.startedOperations).toEqual([
        [expect.objectContaining({ property: "color", value: "blue" })],
        [expect.objectContaining({ property: "color", value: "green" })],
      ]);
      expect(harness.persistedState.get("color")).toBe("green");
      expect(harness.element.style.getPropertyValue("color")).toBe("green");
    } finally {
      harness.cleanup();
    }
  });

  it("persists queued border width before the following border style", async () => {
    const harness = renderWithBlockedFirstSave();

    try {
      const widthCommit = harness.rendered.hook.handleDomStyleCommit("border-width", "4px");
      await harness.firstSaveStarted;
      const styleCommit = harness.rendered.hook.handleDomStyleCommit("border-style", "solid");

      expect(harness.getPersistReadCount()).toBe(1);

      harness.releaseFirstSave();
      await Promise.all([widthCommit, styleCommit]);

      expect(harness.startedOperations).toEqual([
        [expect.objectContaining({ property: "border-width", value: "4px" })],
        [expect.objectContaining({ property: "border-style", value: "solid" })],
      ]);
      expect(harness.persistedState.get("border-width")).toBe("4px");
      expect(harness.persistedState.get("border-style")).toBe("solid");
    } finally {
      harness.cleanup();
    }
  });

  it("keeps a pending border style fresh for a following border width commit", async () => {
    const harness = renderWithBlockedFirstSave();

    try {
      const styleCommit = harness.rendered.hook.handleDomStyleCommit("border-style", "dashed");
      await harness.firstSaveStarted;

      expect(harness.selection.computedStyles["border-style"]).toBe("dashed");
      const widthUpdates = buildStrokeWidthStyleUpdates(
        "4px",
        harness.selection.computedStyles["border-style"],
      );
      expect(widthUpdates).toEqual([["border-width", "4px"]]);

      const widthCommits = widthUpdates.map(([property, value]) =>
        harness.rendered.hook.handleDomStyleCommit(property, value),
      );
      harness.releaseFirstSave();
      await Promise.all([styleCommit, ...widthCommits]);

      expect(harness.persistedState.get("border-style")).toBe("dashed");
      expect(harness.persistedState.get("border-width")).toBe("4px");
      expect(harness.startedOperations.flat().map(({ property }) => property)).toEqual([
        "border-style",
        "border-width",
      ]);
    } finally {
      harness.cleanup();
    }
  });

  it("uses the border style produced by the previous rapid width commit", async () => {
    const harness = renderWithBlockedFirstSave();

    try {
      const firstUpdates = buildStrokeWidthStyleUpdates(
        "2px",
        harness.selection.computedStyles["border-style"],
      );
      expect(firstUpdates).toEqual([
        ["border-width", "2px"],
        ["border-style", "solid"],
      ]);
      const firstCommits = firstUpdates.map(([property, value]) =>
        harness.rendered.hook.handleDomStyleCommit(property, value),
      );
      await harness.firstSaveStarted;

      expect(harness.selection.computedStyles["border-style"]).toBe("solid");
      const secondUpdates = buildStrokeWidthStyleUpdates(
        "4px",
        harness.selection.computedStyles["border-style"],
      );
      expect(secondUpdates).toEqual([["border-width", "4px"]]);
      const secondCommits = secondUpdates.map(([property, value]) =>
        harness.rendered.hook.handleDomStyleCommit(property, value),
      );

      harness.releaseFirstSave();
      await Promise.all([...firstCommits, ...secondCommits]);
      expect(harness.persistedState.get("border-width")).toBe("4px");
    } finally {
      harness.cleanup();
    }
  });

  it("resyncs the same selection after a successful optimistic snapshot update", async () => {
    stubPatchFetch({ ok: true, changed: true, matched: true, content: "" });
    const refreshDomEditSelectionFromPreview = vi.fn<(selection: DomEditSelection) => void>();
    const { iframe, element } = createPreviewElement();
    const selection = createSelection(element);
    const rendered = renderDomEditCommits(selection, iframe, {
      refreshDomEditSelectionFromPreview,
    });

    try {
      await act(async () => {
        await rendered.hook.handleDomStyleCommit("border-style", "dashed");
      });

      expect(rendered.refreshDomEditSelectionFromPreview).toHaveBeenCalledOnce();
      expect(rendered.refreshDomEditSelectionFromPreview).toHaveBeenCalledWith(selection);
    } finally {
      rendered.cleanup();
    }
  });

  it("does not toast a breaker-open style commit and saves again after reset", async () => {
    const saveQueue = createDomEditSaveQueue({ failureThreshold: 1 });
    let patchCount = 0;
    const { element, rendered, cleanup } = renderStyleCommitWithFetch(
      async (input) => {
        const url = requestUrl(input);
        if (url.includes("/api/projects/p1/files/")) {
          return jsonResponse({
            content: '<div data-hf-id="hf-card" style="color: red">Card</div>',
          });
        }
        if (url.includes("/api/projects/p1/file-mutations/patch-element/")) {
          patchCount += 1;
          if (patchCount === 1) throw new Error("network down");
          return jsonResponse({ ok: true, changed: true, matched: true, content: "" });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      },
      { queueDomEditSave: saveQueue.enqueue },
    );

    try {
      await rendered.hook.handleDomStyleCommit("color", "blue");
      await rendered.hook.handleDomStyleCommit("color", "green");

      expect(rendered.showToast).toHaveBeenCalledOnce();
      expect(rendered.showToast).toHaveBeenCalledWith(
        expect.stringContaining("network down"),
        "error",
      );
      expect(element.style.getPropertyValue("color")).toBe("red");

      saveQueue.reset();
      await rendered.hook.handleDomStyleCommit("color", "purple");

      expect(patchCount).toBe(2);
      expect(element.style.getPropertyValue("color")).toBe("purple");
    } finally {
      saveQueue.destroy();
      cleanup();
    }
  });

  it("queues a child text-field style commit behind an unresolved style commit", async () => {
    const harness = renderWithBlockedFirstSave(
      '<div data-hf-id="hf-card"><span>Card</span></div>',
      {
        textFields: [
          textField({
            key: "child:0:span",
            value: "Card",
            source: "child",
            sourceChildIndex: 0,
          }),
        ],
      },
    );

    try {
      const styleCommit = harness.rendered.hook.handleDomStyleCommit("color", "blue");
      await harness.firstSaveStarted;
      const fieldStyleCommit = harness.rendered.hook.handleDomTextFieldStyleCommit(
        "child:0:span",
        "font-weight",
        "700",
      );

      expect(harness.getPersistReadCount()).toBe(1);

      harness.releaseFirstSave();
      await Promise.all([styleCommit, fieldStyleCommit]);
      expect(harness.startedOperations[1]).toEqual([
        {
          type: "inline-style",
          property: "font-weight",
          value: "700",
          childSelector: ":scope > span",
          childIndex: 0,
        },
      ]);
      expect(harness.persistedState.get("font-weight")).toBe("700");
    } finally {
      harness.cleanup();
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

  it("keeps the already-persisted patch and toasts once when the prepareContent write fails", async () => {
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

      // The base patch already landed server-side before the font-face write
      // failed, so this is recorded as a completed edit (not reverted/re-toasted
      // as a full failure) — only the font embellishment is reported as lost.
      expect(rendered.showToast).toHaveBeenCalledTimes(1);
      expect(rendered.showToast).toHaveBeenCalledWith(
        expect.stringContaining("Saved, but couldn't finish updating index.html"),
        "error",
      );
      expect(rendered.showToast).toHaveBeenCalledWith(
        expect.stringContaining("Failed to save index.html (500)"),
        "error",
      );
      expect(rendered.recordEdit).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
      rendered.cleanup();
    }
  });

  it("uses the patched server content as the custom-font write precondition", async () => {
    const patchedContent =
      '<!doctype html><html><head></head><body><div data-hf-id="hf-card">Card</div></body></html>';
    stubPatchFetch(
      { ok: true, changed: true, matched: true, content: patchedContent },
      patchedContent,
    );
    const { iframe, element } = createPreviewElement();
    const selection = createSelection(element, {
      textFields: [textField({ key: "self", value: "Card", source: "self", tagName: "div" })],
    });
    const writeProjectFile = vi.fn(async () => {});
    const rendered = renderDomEditCommits(selection, iframe, { writeProjectFile });

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

      expect(writeProjectFile).toHaveBeenCalledWith(
        "index.html",
        expect.stringContaining("@font-face"),
        patchedContent,
      );
      expect(rendered.showToast).not.toHaveBeenCalled();
    } finally {
      rendered.cleanup();
    }
  });

  it("keeps a rejected patch request (HTTP error) to one toast", async () => {
    const { rendered, cleanup } = renderStyleCommitWithFetch(async (input) => {
      const url = requestUrl(input);
      if (url.includes("/api/projects/p1/files/")) {
        return jsonResponse({
          content: '<div data-hf-id="hf-card" style="color: red">Card</div>',
        });
      }
      if (url.includes("/api/projects/p1/file-mutations/patch-element/")) {
        return jsonResponse({ error: "invalid value", fields: ["style.color"] }, 400);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    try {
      await act(async () => {
        await rendered.hook.handleDomStyleCommit("color", "blue");
      });

      expect(rendered.showToast).toHaveBeenCalledTimes(1);
      expect(rendered.showToast).toHaveBeenCalledWith(
        "Couldn't save edit: invalid value (style.color)",
        "error",
      );
    } finally {
      cleanup();
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

  it("reverts and toasts a text commit when the server rejects the patch", async () => {
    stubPatchFetch(new Error("network down"));
    const { iframe, element } = createPreviewElement('<div data-hf-id="hf-card">Card</div>');
    const selection = createSelection(element, {
      textFields: [textField({ key: "self", value: "Card", source: "self", tagName: "div" })],
    });
    const rendered = renderDomEditCommits(selection, iframe);

    try {
      await act(async () => {
        await rendered.hook.handleDomTextCommit("Updated", "self");
      });

      expect(rendered.showToast).toHaveBeenCalledWith(
        'Couldn\'t save "Hero title": network down',
        "error",
      );
      expect(element.textContent).toBe("Card");
      expect(rendered.recordEdit).not.toHaveBeenCalled();
    } finally {
      rendered.cleanup();
    }
  });
});

describe("useDomEditCommits attribute persist handling", () => {
  beforeEach(() => {
    ensureCssEscape();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("toasts and reverts a data-attribute commit when the server cannot resolve the source element", async () => {
    stubPatchFetch({ ok: true, changed: false, matched: false });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { iframe, element } = createPreviewElement();
    const rendered = renderDomEditCommits(createSelection(element), iframe);

    try {
      await act(async () => {
        await rendered.hook.handleDomAttributeCommit("volume", "0.8");
      });

      expect(rendered.showToast).toHaveBeenCalledWith(
        expect.stringMatching(/Couldn't save "Hero title": Couldn't find this element/),
        "error",
      );
      expect(element.getAttribute("data-volume")).toBeNull();
    } finally {
      warnSpy.mockRestore();
      rendered.cleanup();
    }
  });

  it("toasts and reverts a data-attribute commit when the patch request rejects", async () => {
    stubPatchFetch(new Error("network down"));
    const { iframe, element } = createPreviewElement();
    element.setAttribute("data-volume", "0.5");
    const rendered = renderDomEditCommits(createSelection(element), iframe);

    try {
      await act(async () => {
        await rendered.hook.handleDomAttributeCommit("volume", "0.8");
      });

      expect(rendered.showToast).toHaveBeenCalledWith(
        'Couldn\'t save "Hero title": network down',
        "error",
      );
      expect(element.getAttribute("data-volume")).toBe("0.5");
    } finally {
      rendered.cleanup();
    }
  });

  it("keeps a data-attribute commit on success", async () => {
    stubPatchFetch({
      ok: true,
      changed: true,
      matched: true,
      content: '<div data-hf-id="hf-card" data-volume="0.8">Card</div>',
    });
    const { iframe, element } = createPreviewElement();
    const rendered = renderDomEditCommits(createSelection(element), iframe);

    try {
      await act(async () => {
        await rendered.hook.handleDomAttributeCommit("volume", "0.8");
      });

      expect(rendered.showToast).not.toHaveBeenCalled();
      expect(element.getAttribute("data-volume")).toBe("0.8");
    } finally {
      rendered.cleanup();
    }
  });

  it("toasts and reverts an html-attribute commit when the patch request rejects", async () => {
    stubPatchFetch(new Error("network down"));
    const { iframe, element } = createPreviewElement();
    const rendered = renderDomEditCommits(createSelection(element), iframe);

    try {
      await act(async () => {
        await rendered.hook.handleDomHtmlAttributeCommit("muted", "true");
      });

      expect(rendered.showToast).toHaveBeenCalledWith(
        'Couldn\'t save "Hero title": network down',
        "error",
      );
      expect(element.getAttribute("muted")).toBeNull();
    } finally {
      rendered.cleanup();
    }
  });

  it("keeps a newer html-attribute value when an older overlapping commit later fails", async () => {
    const first = createDeferred<Response>();
    let call = 0;
    const { iframe, element } = createPreviewElement();
    const rendered = renderDomEditCommits(createSelection(element), iframe);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: Parameters<typeof fetch>[0]) => {
        const url = requestUrl(input);
        if (url.includes("/api/projects/p1/files/")) {
          return jsonResponse({ content: '<div data-hf-id="hf-card"></div>' });
        }
        call += 1;
        if (call === 1) return first.promise;
        return jsonResponse({ ok: true, changed: true, matched: true, content: "" });
      }),
    );

    try {
      // Older commit's persist stays pending (captures previousValue=null); the
      // newer commit captures previousValue="first-value" (the older commit's
      // optimistic apply) and succeeds before the older one rejects. Without the
      // per-key version guard, the stale rejection would revert to the older
      // commit's own previousValue (null) and stomp the newer commit's value.
      const firstCommit = act(async () => {
        await rendered.hook.handleDomHtmlAttributeCommit("muted", "first-value");
      });
      await act(async () => {
        await rendered.hook.handleDomHtmlAttributeCommit("muted", "second-value");
      });
      first.reject(new Error("stale request failed"));
      await firstCommit;

      expect(element.getAttribute("muted")).toBe("second-value");
    } finally {
      rendered.cleanup();
    }
  });

  it("persists overlapping attribute commits in issue order", async () => {
    const harness = renderWithBlockedFirstSave('<div data-hf-id="hf-card"></div>');

    try {
      const firstCommit = harness.rendered.hook.handleDomAttributeCommit("volume", "0.5");
      await harness.firstSaveStarted;
      const secondCommit = harness.rendered.hook.handleDomAttributeCommit("volume", "0.8");

      expect(harness.getPersistReadCount()).toBe(1);

      harness.releaseFirstSave();
      await Promise.all([firstCommit, secondCommit]);
      expect(harness.startedOperations).toHaveLength(2);
      expect(harness.persistedState.get("volume")).toBe("0.8");
      expect(harness.element.getAttribute("data-volume")).toBe("0.8");
    } finally {
      harness.cleanup();
    }
  });
});
