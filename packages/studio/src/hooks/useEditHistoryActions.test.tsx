// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEditHistoryActions } from "./useEditHistoryActions";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => act(() => root?.unmount()));

function mount(result: { ok: boolean; reason?: string; label?: string; paths?: string[] }) {
  const editHistory = {
    undo: vi.fn(async (cb: { writeFile: (p: string, c: string) => Promise<void> }) => {
      if (result.ok) await cb.writeFile("index.html", "before");
      return result;
    }),
    redo: vi.fn(async () => result),
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
});
