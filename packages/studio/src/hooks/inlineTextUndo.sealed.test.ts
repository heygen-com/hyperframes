// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { patchElementInHtml } from "@hyperframes/studio-server/source-mutation";
import {
  findPreviewElementForSelection,
  resolveFoundSelection,
  resolvePreviewSelection,
} from "../components/editor/previewSelection";
import { retirePreviewEditingClient } from "../player/lib/previewChannel";
import { sealedPreviewFrame } from "../player/lib/sealedPreviewFrame.test-helpers";
import { hasStudioPendingEdits } from "../utils/studioPendingEdits";
import type { DomEditPatchBatch } from "./domEditCommitTypes";
import type { RecordEditInput } from "./domEditDeleteMembers";
import { jsonResponse, requestUrl } from "./fetchStubTestUtils";
import { useDomEditPersist } from "./useDomEditPersist";
import { useDomEditTextCommits } from "./useDomEditTextCommits";
import { useInlineTextEdit } from "./useInlineTextEdit";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PATH = "index.html";
const OPTIONS = { activeCompositionPath: PATH, isMasterView: false, skipSourceProbe: true };
const ORIGINAL = `<h1 id="title">Hello <b>world</b></h1><p id="other">x</p>`;
const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

/** Studio's file server, patching with the server's own patcher. */
function fileServer() {
  const state = { file: ORIGINAL };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.includes("/files/")) return jsonResponse({ content: state.file });
      if (!url.includes("/patch-element/")) throw new Error(`Unexpected fetch: ${url}`);
      const { target, operations } = JSON.parse(
        String(init?.body),
      ) as DomEditPatchBatch["patches"][0];
      const before = state.file;
      state.file = patchElementInHtml(state.file, target, operations).html;
      const changed = before !== state.file;
      return jsonResponse({
        ok: true,
        changed,
        matched: true,
        content: state.file,
        path: PATH,
        version: "v2",
      });
    }),
  );
  return state;
}

it("saves a sealed inline text edit typed in several steps as one 'Edit text' undo step", async () => {
  document.body.innerHTML = ORIGINAL;
  const title = document.getElementById("title")!;
  const { iframe } = sealedPreviewFrame();
  cleanups.push(() => retirePreviewEditingClient(iframe));
  const found = await findPreviewElementForSelection(
    iframe,
    { id: "title", sourceFile: PATH },
    PATH,
  );
  const selection = (await resolvePreviewSelection(iframe, found!, OPTIONS))!;
  const server = fileServer();
  const entries: RecordEditInput[] = [];
  let controls!: ReturnType<typeof useInlineTextEdit>;
  function Editor() {
    const persist = useDomEditPersist({
      activeCompPath: PATH,
      previewIframeRef: { current: iframe },
      showToast: vi.fn(),
      queueDomEditSave: (save) => save(),
      writeProjectFile: vi.fn(async () => {}),
      editHistory: { recordEdit: async (entry) => void entries.push(entry) },
      projectIdRef: { current: "p1" },
      reloadPreview: vi.fn(),
      forceReloadSdkSession: vi.fn(),
    });
    const commits = useDomEditTextCommits({
      activeCompPath: PATH,
      previewIframeRef: { current: iframe },
      showToast: vi.fn(),
      reloadPreview: vi.fn(),
      domEditSelection: selection,
      applyDomSelection: vi.fn(),
      refreshDomEditSelectionFromPreview: vi.fn(),
      buildDomSelectionFromTarget: (target, options) =>
        resolveFoundSelection(iframe, target, { ...OPTIONS, ...options }),
      persistDomEditOperations: persist,
      resolveImportedFontAsset: () => null,
      readOnlyPreview: false,
    });
    controls = useInlineTextEdit({ onCommit: commits.handleDomRichTextCommit });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Editor)));
  cleanups.push(() => act(() => root.unmount()));

  act(() => void controls.start(selection.element));
  await vi.waitFor(() => expect(title.getAttribute("contenteditable")).toBe("true"));
  for (const typed of ["D", "Dra", "Draft <b>world</b>"]) {
    title.innerHTML = typed;
    await act(() => new Promise((resolve) => setTimeout(resolve)));
  }
  act(() => controls.commit());
  await vi.waitFor(() => expect(hasStudioPendingEdits()).toBe(false));
  const unmarked = (html: string) => html.replace(/ data-hf-id="[^"]*"/g, "");
  await vi.waitFor(() => expect(unmarked(server.file)).toContain("Draft <b>world</b>"));

  expect(entries.map(({ label }) => label)).toEqual(["Edit text"]);
  expect(entries[0]!.files[PATH]).toEqual({ before: ORIGINAL, after: server.file });
});
