// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STUDIO_MOTION_PATH } from "../components/editor/studioMotion";
import { useEditHistoryActions, type EditHistoryHandle } from "./useEditHistoryActions";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => act(() => root?.unmount()));

function mount(result: { ok: boolean; reason?: string; label?: string; paths?: string[] }) {
  const editHistory = {
    undo: vi.fn<EditHistoryHandle["undo"]>(async (cb) => {
      if (result.ok) await cb.writeFile("index.html", "before");
      return result;
    }),
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
  it("undo writes through the host writer, resyncs the preview and toasts the label", async () => {
    const { deps, actions } = mount({ ok: true, label: "Move clip", paths: ["index.html"] });
    await act(() => actions.undo());
    expect(deps.waitForPendingDomEditSaves).toHaveBeenCalled();
    expect(deps.writeProjectFile).toHaveBeenCalledWith("index.html", "before");
    expect(deps.onAfterUndoRedo).toHaveBeenCalled();
    expect(deps.forceReloadSdkSession).toHaveBeenCalled();
    expect(deps.syncHistoryPreviewAfterApply).toHaveBeenCalled();
    expect(deps.showToast).toHaveBeenCalledWith("Undid Move clip", "info");
  });

  it("redo reports the redone label and skips the SDK reload for other files", async () => {
    const { deps, actions } = mount({ ok: true, label: "Split clip", paths: ["other.html"] });
    await act(() => actions.redo());
    expect(deps.forceReloadSdkSession).not.toHaveBeenCalled();
    expect(deps.showToast).toHaveBeenCalledWith("Redid Split clip", "info");
  });

  it("explains a refused undo when the file changed on disk", async () => {
    const { deps, actions } = mount({ ok: false, reason: "content-mismatch" });
    await act(() => actions.undo());
    expect(deps.showToast).toHaveBeenCalledWith(
      "File changed outside Studio. Undo history was not applied.",
      "info",
    );
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
