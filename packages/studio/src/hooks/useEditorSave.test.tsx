// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditorSave, type EditorSaveHandle } from "./useEditorSave";
import { StudioFileConflictError } from "../utils/studioSaveDiagnostics";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useEditorSave pending work", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 41),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => vi.unstubAllGlobals());

  it("exposes and flushes the latest rAF-buffered source candidate", async () => {
    const writeProjectFile = vi.fn(async () => undefined);
    const captured: { handle: EditorSaveHandle | null } = { handle: null };

    function Probe() {
      captured.handle = useEditorSave({
        editingPathRef: { current: "index.html" },
        projectIdRef: { current: "project-a" },
        readProjectFile: vi.fn(async () => "before"),
        writeProjectFile,
        recordEdit: vi.fn(async () => undefined),
        domEditSaveTimestampRef: { current: 0 },
        setRefreshKey: vi.fn(),
        showToast: vi.fn(),
      });
      return null;
    }

    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe />));
    act(() => captured.handle?.handleContentChange("studio candidate"));

    expect(captured.handle?.getPendingCandidate()).toEqual({
      projectId: "project-a",
      path: "index.html",
      content: "studio candidate",
    });
    await expect(captured.handle?.flushPendingSave()).resolves.toEqual({ status: "clean" });
    expect(writeProjectFile).toHaveBeenCalledWith("index.html", "studio candidate", "before");

    await act(async () => root.unmount());
  });

  it("joins an in-flight source save instead of writing the frozen candidate twice", async () => {
    let frame: FrameRequestCallback | null = null;
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        frame = callback;
        return 42;
      }),
    );
    let finishWrite!: () => void;
    const writeProjectFile = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishWrite = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const captured: { handle: EditorSaveHandle | null } = { handle: null };
    function Probe() {
      captured.handle = useEditorSave({
        editingPathRef: { current: "index.html" },
        projectIdRef: { current: "project-a" },
        readProjectFile: vi.fn(async () => "before"),
        writeProjectFile,
        recordEdit: vi.fn(async () => undefined),
        domEditSaveTimestampRef: { current: 0 },
        setRefreshKey: vi.fn(),
        showToast: vi.fn(),
      });
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe />));
    act(() => captured.handle?.handleContentChange("candidate"));
    act(() => frame?.(0));
    await vi.waitFor(() => expect(writeProjectFile).toHaveBeenCalledOnce());

    const drained = captured.handle?.flushPendingSave();
    expect(writeProjectFile).toHaveBeenCalledOnce();
    finishWrite();
    await expect(drained).resolves.toEqual({ status: "clean" });
    expect(writeProjectFile).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  });

  it("preserves conflict details when flushing a buffered source candidate", async () => {
    const conflict = new StudioFileConflictError({
      filePath: "index.html",
      currentVersion: "external-v2",
      currentContent: "external",
      attemptedContent: "studio candidate",
    });
    const captured: { handle: EditorSaveHandle | null } = { handle: null };

    function Probe() {
      captured.handle = useEditorSave({
        editingPathRef: { current: "index.html" },
        projectIdRef: { current: "project-a" },
        readProjectFile: vi.fn(async () => "before"),
        writeProjectFile: vi.fn(async () => {
          throw conflict;
        }),
        recordEdit: vi.fn(async () => undefined),
        domEditSaveTimestampRef: { current: 0 },
        setRefreshKey: vi.fn(),
        showToast: vi.fn(),
      });
      return null;
    }

    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe />));
    act(() => captured.handle?.handleContentChange("studio candidate"));

    await expect(captured.handle?.flushPendingSave()).resolves.toEqual({
      status: "conflict",
      error: conflict,
    });

    await act(async () => root.unmount());
  });

  it("discards an rAF-buffered candidate without persisting it", async () => {
    const writeProjectFile = vi.fn(async () => undefined);
    const captured: { handle: EditorSaveHandle | null } = { handle: null };

    function Probe() {
      captured.handle = useEditorSave({
        editingPathRef: { current: "index.html" },
        projectIdRef: { current: "project-a" },
        readProjectFile: vi.fn(async () => "before"),
        writeProjectFile,
        recordEdit: vi.fn(async () => undefined),
        domEditSaveTimestampRef: { current: 0 },
        setRefreshKey: vi.fn(),
        showToast: vi.fn(),
      });
      return null;
    }

    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Probe />));
    act(() => captured.handle?.handleContentChange("discard me"));
    act(() => captured.handle?.discardPendingSave());

    expect(captured.handle?.getPendingCandidate()).toBeNull();
    await expect(captured.handle?.flushPendingSave()).resolves.toEqual({ status: "clean" });
    expect(writeProjectFile).not.toHaveBeenCalled();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(41);

    await act(async () => root.unmount());
  });
});
