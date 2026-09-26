// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  createStudioApi,
  fileContentVersion,
  identifyFileWrite,
  openProjectHistory,
  type StudioApiAdapter,
} from "@hyperframes/studio-server";
import { consumeStudioWriteToken } from "../utils/studioFileVersion";
import { usePersistentEditHistory } from "./usePersistentEditHistory";

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

/** The hook over the real history routes and engine, on a project whose index.html reads "A". */
async function studio({ withHistory = true } = {}) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const dir = tempDir("hf-studio-history-");
  writeFileSync(join(dir, "index.html"), "A");
  const history = await openProjectHistory({
    projectDir: dir,
    historyRoot: tempDir("hf-studio-history-root-"),
  });
  cleanup.push(() => history.close());
  const api = createStudioApi({
    listProjects: () => [],
    resolveProject: (id: string) => (id === "demo" ? { id, dir } : null),
    ...(withHistory && { history: () => history }),
  } as unknown as StudioApiAdapter);
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
    api.request(url.replace(/^\/api/, ""), init),
  );
  let hook!: ReturnType<typeof usePersistentEditHistory>;
  function Harness() {
    hook = usePersistentEditHistory({ projectId: "demo" });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Harness)));
  cleanup.push(() => act(() => root.unmount()));
  const file = () => readFileSync(join(dir, "index.html"), "utf8");
  const save = (content: string) => writeFileSync(join(dir, "index.html"), content);
  const readFile = async (path: string) => readFileSync(join(dir, path), "utf8");
  return { dir, hook: () => hook, file, save, readFile };
}

it("an edit Studio saved is undone and redone by the project's history, with the preview's before and after", async () => {
  const { hook, file, save, readFile } = await studio();
  save("B");
  await act(() =>
    hook().recordEdit({
      label: "Moved Title",
      kind: "manual",
      files: { "index.html": { before: "A", after: "B" } },
    }),
  );
  await vi.waitFor(() => expect(hook().undoLabel).toBe("Moved Title"));

  const undone = await act(() => hook().undo({ readFile }));
  expect(undone).toEqual({
    ok: true,
    label: "Undid: Moved Title",
    paths: ["index.html"],
    files: { "index.html": { previous: "B", restored: "A" } },
  });
  expect(file()).toBe("A");

  await vi.waitFor(() => expect(hook().canRedo).toBe(true));
  const redone = await act(() => hook().redo({ readFile }));
  expect(redone).toMatchObject({ ok: true, label: "Redid: Moved Title" });
  expect(file()).toBe("B");
});

it("a drag's edits under one key undo as one step, even before the drag goes idle", async () => {
  const { hook, file, save, readFile } = await studio();
  for (const content of ["B", "C"]) {
    save(content);
    await act(() =>
      hook().recordEdit({
        label: "Dragged Title",
        kind: "manual",
        coalesceKey: "drag",
        coalesceMs: 60_000,
        files: { "index.html": { before: "A", after: content } },
      }),
    );
  }
  const undone = await act(() => hook().undo({ readFile }));
  expect(undone).toMatchObject({
    ok: true,
    label: "Undid: Dragged Title",
    files: { "index.html": { previous: "C", restored: "A" } },
  });
  expect(file()).toBe("A");
});

it("an agent's edit made seconds before Studio's stays the agent's: Cmd+Z undoes only Studio's", async () => {
  const { hook, file, save, readFile } = await studio();
  save("B");
  await act(() => hook().recordEdit({ label: "sweep", kind: "manual", files: {} }));
  save("C");
  await act(() =>
    hook().recordEdit({
      label: "Moved Title",
      kind: "manual",
      files: { "index.html": { before: "B", after: "C" } },
    }),
  );
  expect(await act(() => hook().undo({ readFile }))).toMatchObject({ label: "Undid: Moved Title" });
  expect(file()).toBe("B");
});

it("an undo's writes carry the write token Studio marked, so their echo is not read as an outside edit", async () => {
  const { dir, hook, save, readFile } = await studio();
  save("B");
  await act(() =>
    hook().recordEdit({
      label: "Moved Title",
      kind: "manual",
      files: { "index.html": { before: "A", after: "B" } },
    }),
  );
  await act(() => hook().undo({ readFile }));
  const receipt = identifyFileWrite(join(dir, "index.html"), fileContentVersion("A"));
  expect(consumeStudioWriteToken(receipt?.writeToken ?? null)).toBe(true);
});

it("without a history on the server an edit still saves, and there is nothing to undo", async () => {
  const { hook, file, save, readFile } = await studio({ withHistory: false });
  save("B");
  await act(() =>
    hook().recordEdit({
      label: "Moved Title",
      kind: "manual",
      files: { "index.html": { before: "A", after: "B" } },
    }),
  );
  expect(hook().canUndo).toBe(false);
  expect(await act(() => hook().undo({ readFile }))).toEqual({ ok: false, reason: "empty" });
  expect(file()).toBe("B");
});

/** Answers Cmd+Z's step with `reply` instead of the engine, every other request as before. */
function answerStep(status: number, reply: object) {
  const real = globalThis.fetch;
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
    url.endsWith("/history/step")
      ? Promise.resolve(new Response(JSON.stringify(reply), { status }))
      : real(url, init),
  );
}

it("a step the server could not take says why, instead of reading as nothing to undo", async () => {
  const { hook, readFile } = await studio();
  answerStep(500, { error: "disk full" });
  expect(await act(() => hook().undo({ readFile }))).toEqual({
    ok: false,
    reason: "failed",
    message: "disk full",
  });
});

it("a refused step names the edit it would have undone and the files that changed after it", async () => {
  const { hook, save, readFile } = await studio();
  save("B");
  await act(() =>
    hook().recordEdit({
      label: "Moved Title",
      kind: "manual",
      files: { "index.html": { before: "A", after: "B" } },
    }),
  );
  await vi.waitFor(() => expect(hook().undoLabel).toBe("Moved Title"));
  answerStep(200, { ok: false, conflict: { files: ["index.html"], newer: [] } });
  expect(await act(() => hook().undo({ readFile }))).toEqual({
    ok: false,
    reason: "content-mismatch",
    label: "Moved Title",
    paths: ["index.html"],
  });
});
