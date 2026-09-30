// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  createStudioApi,
  openProjectHistory,
  type StudioApiAdapter,
} from "@hyperframes/studio-server";
import { useEditHistoryActions } from "./useEditHistoryActions";
import { usePersistentEditHistory } from "./usePersistentEditHistory";
import { usePreviewPersistence } from "./usePreviewPersistence";

const page = (left: string) =>
  `<!doctype html><html><head></head><body><div id="root" data-composition-id="main"><div id="box" style="position: absolute; left: ${left}"></div></div></body></html>`;
const BEFORE = page("10px");
const AFTER = page("50px");

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
  vi.unstubAllGlobals();
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Studio's undo wired as App.tsx wires it, over the real history engine, with a live preview document. */
async function studio() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const dir = tempDir("hf-undo-paint-");
  const path = join(dir, "index.html");
  writeFileSync(path, BEFORE);
  const engine = await openProjectHistory({
    projectDir: dir,
    historyRoot: tempDir("hf-undo-paint-root-"),
  });
  cleanup.push(() => engine.close());
  const api = createStudioApi({
    listProjects: () => [],
    resolveProject: (id: string) => (id === "demo" ? { id, dir } : null),
    history: () => engine,
  } as unknown as StudioApiAdapter);
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
    api.request(url.replace(/^\/api/, ""), init),
  );
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  cleanup.push(() => iframe.remove());
  const reloads = vi.fn();
  const readFile = async (p: string) => readFileSync(join(dir, p), "utf8");
  let history!: ReturnType<typeof usePersistentEditHistory>;
  let persistence!: ReturnType<typeof usePreviewPersistence>;
  let actions!: ReturnType<typeof useEditHistoryActions>;
  function Harness() {
    history = usePersistentEditHistory({ projectId: "demo" });
    persistence = usePreviewPersistence({
      showToast: () => {},
      readOptionalProjectFile: async () => "",
      writeProjectFile: async () => {},
      recordEdit: async () => {},
      previewIframeRef: { current: iframe },
      activeCompPathRef: { current: "index.html" },
      reloadPreview: reloads,
    });
    actions = useEditHistoryActions({
      editHistory: history,
      readOptionalProjectFile: async () => "",
      readProjectFile: readFile,
      writeProjectFile: async (p, content) => writeFileSync(join(dir, p), content),
      showToast: () => {},
      syncHistoryPreviewAfterApply: persistence.syncHistoryPreviewAfterApply,
      showHistoryRestoreNow: persistence.showHistoryRestoreNow,
      waitForPendingDomEditSaves: persistence.waitForPendingDomEditSaves,
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Harness)));
  cleanup.push(() => act(() => root.unmount()));
  const box = () => iframe.contentDocument!.getElementById("box")!.style.left;
  const show = (html: string) => {
    iframe.contentDocument!.documentElement.innerHTML = new DOMParser().parseFromString(
      html,
      "text/html",
    ).documentElement.innerHTML;
  };
  /** A move Studio saved: the live preview already shows it, then the file and the history claim land. */
  const edit = async () => {
    show(AFTER);
    writeFileSync(path, AFTER);
    await act(() =>
      history.recordEdit({
        label: "Move layer",
        files: { "index.html": { before: BEFORE, after: AFTER } },
      }),
    );
    await vi.waitFor(() => expect(history.undoLabel).toBe("Move layer"));
  };
  return {
    history: () => history,
    persistence: () => persistence,
    actions: () => actions,
    box,
    edit,
    file: () => readFileSync(path, "utf8"),
    reloads,
  };
}

it("undo and redo of a style edit paint in the key's own task, before the server answers", async () => {
  const s = await studio();
  await s.edit();

  const undone = s.actions().undo();
  expect(s.box()).toBe("10px");
  await act(() => undone);
  expect(s.file()).toBe(BEFORE);
  expect(s.box()).toBe("10px");

  await vi.waitFor(() => expect(s.history().redoLabel).toBeTruthy());
  const redone = s.actions().redo();
  expect(s.box()).toBe("50px");
  await act(() => redone);
  expect(s.file()).toBe(AFTER);
  expect(s.box()).toBe("50px");
  expect(s.reloads).not.toHaveBeenCalled();
});

it("an undo pressed while a save is still running waits for the server instead of guessing", async () => {
  const s = await studio();
  await s.edit();
  let finish!: () => void;
  const saving = new Promise<void>((resolve) => (finish = resolve));
  void s.persistence().queueDomEditSave(() => saving);

  const undone = s.actions().undo();
  expect(s.box()).toBe("50px");
  finish();
  await act(() => undone);
  expect(s.file()).toBe(BEFORE);
  expect(s.box()).toBe("10px");
});
