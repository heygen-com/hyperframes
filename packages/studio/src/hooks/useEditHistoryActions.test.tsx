// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STUDIO_MOTION_PATH } from "../components/editor/studioMotion";
import { useEditHistoryActions, type EditHistoryHandle } from "./useEditHistoryActions";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => act(() => root?.unmount()));

function mount(result: {
  ok: boolean;
  reason?: string;
  message?: string;
  label?: string;
  paths?: string[];
}) {
  const editHistory = {
    undo: vi.fn<EditHistoryHandle["undo"]>(async () => result),
    redo: vi.fn<EditHistoryHandle["redo"]>(async () => result),
  };
  const deps = {
    editHistory,
    readOptionalProjectFile: vi.fn(async () => ""),
    readProjectFile: vi.fn(async () => ""),
    writeProjectFile: vi.fn(async () => undefined),
    showToast: vi.fn(),
    syncHistoryPreviewAfterApply: vi.fn(async () => undefined),
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

describe("useEditHistoryActions", () => {
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

  it("names the step and the files that changed after it when an undo is refused", async () => {
    const { deps, actions } = mount({
      ok: false,
      reason: "content-mismatch",
      label: "Moved Title",
      paths: ["index.html"],
    });
    await act(() => actions.undo());
    expect(deps.showToast).toHaveBeenCalledWith(
      'Can\'t undo "Moved Title": index.html changed after it.',
      "info",
    );
    expect(deps.syncHistoryPreviewAfterApply).not.toHaveBeenCalled();
  });

  it("says why when the history could not take the step", async () => {
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
