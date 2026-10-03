// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DomEditSelection } from "../components/editor/domEditing";
import type { PatchOperation } from "../utils/sourcePatcher";
import type { CutoverResult } from "../utils/sdkCutover";
import {
  DomEditPersistUnresolvableError,
  DomEditPersistUnsafeValueError,
} from "./domEditPersistFailure";
import type { PersistDomEditOperations } from "./domEditCommitTypes";
import { jsonResponse, requestUrl } from "./fetchStubTestUtils";
import { useDomEditPersist, type UseDomEditPersistParams } from "./useDomEditPersist";

const trackStudioEvent = vi.fn();
const reseekPreviewRuntime = vi.fn();
vi.mock("../utils/studioTelemetry", () => ({
  trackStudioEvent: (...args: unknown[]) => trackStudioEvent(...args),
}));
vi.mock("./timelineTrackVisibility", () => ({
  reseekPreviewRuntime: (...args: unknown[]) => reseekPreviewRuntime(...args),
}));

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const SOURCE = '<div data-hf-id="hf-card" style="color: red">Card</div>';
const PATCHED = '<div data-hf-id="hf-card" style="color: blue">Card</div>';
const OPERATIONS: PatchOperation[] = [{ type: "inline-style", property: "color", value: "blue" }];
const selection = {
  hfId: "hf-card",
  selector: '[data-hf-id="hf-card"]',
  selectorIndex: 0,
  sourceFile: "index.html",
} as DomEditSelection;

function stubServer(patchResponse: Record<string, unknown>) {
  const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], _init?: RequestInit) => {
    const url = requestUrl(input);
    if (url.includes("/api/projects/p1/files/")) return jsonResponse({ content: SOURCE });
    if (url.includes("/api/projects/p1/file-mutations/patch-element/")) {
      return jsonResponse(patchResponse);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const patchPosts = (fetchMock: ReturnType<typeof stubServer>) =>
  fetchMock.mock.calls.filter(([input]) => requestUrl(input).includes("/patch-element/"));

let unmount: (() => void) | null = null;

function renderPersist(over: Partial<UseDomEditPersistParams> = {}) {
  const params: UseDomEditPersistParams = {
    activeCompPath: "index.html",
    previewIframeRef: { current: null },
    showToast: vi.fn(),
    queueDomEditSave: (save) => save(),
    writeProjectFile: vi.fn(async () => {}),
    editHistory: { recordEdit: vi.fn(async () => {}) },
    projectIdRef: { current: "p1" },
    reloadPreview: vi.fn(),
    forceReloadSdkSession: vi.fn(),
    ...over,
  };
  const captured: { persist: PersistDomEditOperations | null } = { persist: null };
  function Probe() {
    captured.persist = useDomEditPersist(params);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Probe)));
  unmount = () => act(() => root.unmount());
  if (!captured.persist) throw new Error("hook did not initialize");
  return { persist: captured.persist, params };
}

describe("useDomEditPersist", () => {
  beforeEach(() => {
    trackStudioEvent.mockReset();
    reseekPreviewRuntime.mockReset();
  });
  afterEach(() => {
    unmount?.();
    unmount = null;
    vi.unstubAllGlobals();
  });

  it("patches the source, records the edit and reloads the preview", async () => {
    const fetchMock = stubServer({
      changed: true,
      content: PATCHED,
      path: "index.html",
      version: "v2",
    });
    const { persist, params } = renderPersist();

    const outcome = await persist(selection, OPERATIONS, { label: "Recolor" });

    expect(outcome).toEqual({ sourceFile: "index.html", version: "v2", changed: true });
    const [, init] = patchPosts(fetchMock)[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({
      target: { hfId: "hf-card", selector: '[data-hf-id="hf-card"]', selectorIndex: 0 },
      operations: OPERATIONS,
    });
    expect(params.editHistory.recordEdit).toHaveBeenCalledWith({
      label: "Recolor",
      coalesceKey: undefined,
      coalesceMs: undefined,
      files: { "index.html": { before: SOURCE, after: PATCHED } },
    });
    expect(params.forceReloadSdkSession).toHaveBeenCalledTimes(1);
    expect(params.reloadPreview).toHaveBeenCalledTimes(1);
    expect(reseekPreviewRuntime).not.toHaveBeenCalled();
  });

  it("with skipRefresh reseeks the preview instead of reloading it", async () => {
    stubServer({ changed: true, content: PATCHED, path: "index.html", version: "v2" });
    const { persist, params } = renderPersist();

    await persist(selection, OPERATIONS, { skipRefresh: true });

    expect(params.reloadPreview).not.toHaveBeenCalled();
    expect(reseekPreviewRuntime).toHaveBeenCalledTimes(1);
  });

  it("an unchanged patch records nothing and reports changed: false", async () => {
    stubServer({ changed: false, matched: true, path: "index.html", version: "v1" });
    const { persist, params } = renderPersist();

    const outcome = await persist(selection, OPERATIONS);

    expect(outcome).toEqual({ sourceFile: "index.html", version: "v1", changed: false });
    expect(params.editHistory.recordEdit).not.toHaveBeenCalled();
    expect(params.reloadPreview).not.toHaveBeenCalled();
  });

  it("an unmatched target throws and is reported once per target", async () => {
    stubServer({ changed: false, matched: false });
    const { persist } = renderPersist();

    await expect(persist(selection, OPERATIONS)).rejects.toBeInstanceOf(
      DomEditPersistUnresolvableError,
    );
    await expect(persist(selection, OPERATIONS)).rejects.toBeInstanceOf(
      DomEditPersistUnresolvableError,
    );

    expect(trackStudioEvent).toHaveBeenCalledTimes(1);
    expect(trackStudioEvent).toHaveBeenCalledWith(
      "save_skipped_unresolvable",
      expect.objectContaining({ target_selector: '[data-hf-id="hf-card"]' }),
    );
  });

  it("refuses a non-finite layout value before any request, with a toast", async () => {
    const fetchMock = stubServer({ changed: true });
    const { persist, params } = renderPersist();

    await expect(
      persist({ ...selection, selectorIndex: Number.NaN }, OPERATIONS),
    ).rejects.toBeInstanceOf(DomEditPersistUnsafeValueError);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(params.showToast).toHaveBeenCalledWith(
      "Couldn't save edit because it contains invalid layout values",
      "error",
    );
  });

  it("a committed SDK cutover skips the server patch and the reload", async () => {
    const fetchMock = stubServer({ changed: true });
    const onTrySdkPersist = vi.fn(
      async (): Promise<CutoverResult> => ({
        status: "committed",
        version: "sdk-3",
        before: SOURCE,
        after: PATCHED,
      }),
    );
    const { persist, params } = renderPersist({ onTrySdkPersist });

    const outcome = await persist(selection, OPERATIONS, { label: "Recolor" });

    expect(outcome).toEqual({ sourceFile: "index.html", version: "sdk-3", changed: true });
    expect(onTrySdkPersist).toHaveBeenCalledWith(selection, OPERATIONS, SOURCE, "index.html", {
      label: "Recolor",
      coalesceKey: undefined,
      skipRefresh: undefined,
    });
    expect(patchPosts(fetchMock)).toHaveLength(0);
    expect(params.reloadPreview).not.toHaveBeenCalled();
    expect(params.forceReloadSdkSession).not.toHaveBeenCalled();
  });

  it("does nothing when shouldSave says no", async () => {
    const fetchMock = stubServer({ changed: true });
    const { persist } = renderPersist();

    await expect(persist(selection, OPERATIONS, { shouldSave: () => false })).resolves.toBe(
      undefined,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses to save once the active project has changed", async () => {
    stubServer({ changed: true });
    const projectIdRef = { current: "p1" as string | null };
    const { persist, params } = renderPersist({
      projectIdRef,
      queueDomEditSave: async (save) => {
        projectIdRef.current = "p2";
        return save();
      },
    });

    await expect(persist(selection, OPERATIONS)).rejects.toThrow(
      "Active project changed before the edit could be saved",
    );
    expect(params.editHistory.recordEdit).not.toHaveBeenCalled();
  });
});
