// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STUDIO_MOTION_PATH } from "../components/editor/studioMotion";
import { useEditHistoryActions, type EditHistoryHandle } from "./useEditHistoryActions";
import { trackStudioPendingEdit } from "../utils/studioPendingEdits";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => act(() => root?.unmount()));

type RestoreFiles = Record<string, { previous: string; restored: string }>;
type Prediction = { id: string; files: RestoreFiles };

function mount(
  result: {
    ok: boolean;
    reason?: string;
    message?: string;
    label?: string;
    paths?: string[];
    undoes?: string;
    files?: RestoreFiles;
  },
  predicted?: Prediction,
) {
  const editHistory = {
    undo: vi.fn<EditHistoryHandle["undo"]>(async () => result),
    redo: vi.fn<EditHistoryHandle["redo"]>(async () => result),
    predict: () => predicted ?? null,
    claims: () => 7,
  };
  const putBack = vi.fn();
  const deps = {
    editHistory,
    readOptionalProjectFile: vi.fn(async () => ""),
    readProjectFile: vi.fn(async () => ""),
    writeProjectFile: vi.fn(async () => undefined),
    showToast: vi.fn(),
    syncHistoryPreviewAfterApply: vi.fn(async (_restore: unknown) => undefined),
    putBack,
    showHistoryRestoreNow: vi.fn((_files: RestoreFiles) => putBack),
    waitForPendingDomEditSaves: vi.fn(async () => undefined),
    onAfterUndoRedo: vi.fn(),
    activeCompPath: "index.html",
    forceReloadSdkSession: vi.fn(),
  };
  let actions!: ReturnType<typeof useEditHistoryActions>;
  function Probe() {
    actions = useEditHistoryActions(deps);
    return null;
  }
  root = createRoot(document.createElement("div"));
  act(() => root!.render(createElement(Probe)));
  return { deps, actions };
}

const PREDICTED = { id: "e1", files: { "index.html": { previous: "B", restored: "A" } } };
const SERVER_FILES = { "index.html": { previous: "B", restored: "A2" } };

describe("useEditHistoryActions", () => {
  it("asks for the edit claimed after the key's claim count only when an edit was saving at the key", async () => {
    const { deps, actions } = mount({ ok: false, reason: "empty" });
    await act(() => actions.undo());
    expect(deps.editHistory.undo.mock.calls[0]![0].claimedAfter).toBeUndefined();

    let land!: () => void;
    trackStudioPendingEdit(new Promise<void>((resolve) => (land = resolve)));
    const undone = actions.undo();
    land();
    await act(() => undone);
    expect(deps.editHistory.undo.mock.calls[1]![0].claimedAfter).toBe(7);
  });

  it("corrects a shown step from the server's restore, diffed from what the preview shows", async () => {
    const { deps, actions } = mount(
      { ok: true, label: "Undid: Move", paths: ["index.html"], undoes: "e1", files: SERVER_FILES },
      PREDICTED,
    );
    await act(() => actions.undo());
    expect(deps.showHistoryRestoreNow).toHaveBeenCalledWith(PREDICTED.files);
    expect(deps.putBack).not.toHaveBeenCalled();
    expect(deps.syncHistoryPreviewAfterApply).toHaveBeenCalledWith({
      paths: ["index.html"],
      files: { "index.html": { previous: "A", restored: "A2" } },
    });
  });

  it("puts a shown step back and applies the server's own restore when it stepped another entry", async () => {
    const { deps, actions } = mount(
      {
        ok: true,
        label: "Undid: Outside",
        paths: ["index.html"],
        undoes: "e0",
        files: SERVER_FILES,
      },
      PREDICTED,
    );
    await act(() => actions.undo());
    expect(deps.putBack).toHaveBeenCalledTimes(1);
    expect(deps.syncHistoryPreviewAfterApply).toHaveBeenCalledWith({
      paths: ["index.html"],
      files: SERVER_FILES,
    });
  });

  it("puts a shown step back when the server refuses it", async () => {
    const { deps, actions } = mount(
      { ok: false, reason: "failed", message: "disk full" },
      PREDICTED,
    );
    await act(() => actions.undo());
    expect(deps.putBack).toHaveBeenCalledTimes(1);
    expect(deps.syncHistoryPreviewAfterApply).not.toHaveBeenCalled();
  });

  it("undo resyncs the preview and toasts the step as the history names it", async () => {
    const { deps, actions } = mount({ ok: true, label: "Undid: Move clip", paths: ["index.html"] });
    await act(() => actions.undo());
    expect(deps.waitForPendingDomEditSaves).toHaveBeenCalled();
    expect(deps.onAfterUndoRedo).toHaveBeenCalled();
    expect(deps.forceReloadSdkSession).toHaveBeenCalled();
    expect(deps.syncHistoryPreviewAfterApply).toHaveBeenCalled();
    expect(deps.showToast).toHaveBeenCalledWith("Undid: Move clip", "info");
  });

  it("redo reports the redone label and skips the SDK reload for other files", async () => {
    const { deps, actions } = mount({
      ok: true,
      label: "Redid: Split clip",
      paths: ["other.html"],
    });
    await act(() => actions.redo());
    expect(deps.forceReloadSdkSession).not.toHaveBeenCalled();
    expect(deps.showToast).toHaveBeenCalledWith("Redid: Split clip", "info");
  });

  it("names the files that changed since the edit when an undo is refused", async () => {
    const { deps, actions } = mount({
      ok: false,
      reason: "content-mismatch",
      paths: ["index.html"],
    });
    await act(() => actions.undo());
    expect(deps.showToast).toHaveBeenCalledWith(
      "Can't undo: index.html changed since that edit.",
      "info",
    );
    expect(deps.syncHistoryPreviewAfterApply).not.toHaveBeenCalled();
  });

  it("says why when the history could not take the step, with nothing shown to take back", async () => {
    const { deps, actions } = mount({ ok: false, reason: "failed", message: "disk full" });
    await act(() => actions.undo());
    expect(deps.showToast).toHaveBeenCalledWith("Undo failed: disk full", "error");
    expect(deps.syncHistoryPreviewAfterApply).not.toHaveBeenCalled();
  });

  it("waits for pending saves first and reads the motion file through the optional reader", async () => {
    const { deps, actions } = mount({ ok: true, label: "Move clip", paths: ["index.html"] });
    const order: string[] = [];
    deps.waitForPendingDomEditSaves.mockImplementation(async () => void order.push("wait"));
    deps.editHistory.undo.mockImplementation(async (cb) => {
      order.push("undo");
      await cb.readFile(STUDIO_MOTION_PATH);
      await cb.readFile("index.html");
      await cb.serialize?.(["index.html"], async () => order.push("serialized"));
      return { ok: true };
    });
    await act(() => actions.undo());
    expect(order).toEqual(["wait", "undo", "serialized"]);
    expect(deps.readOptionalProjectFile).toHaveBeenCalledWith(STUDIO_MOTION_PATH);
    expect(deps.readProjectFile).toHaveBeenCalledWith("index.html");
    expect(deps.readProjectFile).not.toHaveBeenCalledWith(STUDIO_MOTION_PATH);
  });
});
