// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ensureHfIds } from "@hyperframes/parsers/hf-ids";
import { afterEach, expect, it, vi } from "vitest";
import { useClipboard } from "./useClipboard";
import { usePlayerStore, type TimelineElement } from "../player";
import type { DomEditSelection } from "../components/editor/domEditing";
import { sealedPreviewFrame } from "../player/lib/sealedPreviewFrame.test-helpers";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SAVED = `<!doctype html><html><body>
<div data-composition-id="main" data-start="0" data-duration="10">
<h1 id="title" class="clip" data-start="2" data-duration="3" data-track-index="0">Title</h1>
<h2 id="other" class="clip" data-start="6" data-duration="2" data-track-index="1">Other</h2>
</div></body></html>`;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
  usePlayerStore.getState().reset();
  document.body.innerHTML = "";
});

/** A sealed preview of SAVED, with the runtime's hide on the clip, and the saved file served. */
function sealedClipboard(domSelection: DomEditSelection | null) {
  const preview = new DOMParser().parseFromString(ensureHfIds(SAVED), "text/html");
  document.body.innerHTML = preview.body.innerHTML;
  document.getElementById("title")!.style.cssText = "visibility: hidden; display: none";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ content: SAVED }))),
  );
  const { iframe } = sealedPreviewFrame();
  const writes: string[] = [];
  const deleted: string[] = [];
  const view = { projectId: "p" };
  let api: ReturnType<typeof useClipboard> | null = null;
  function Harness() {
    api = useClipboard({
      projectId: view.projectId,
      activeCompPath: "index.html",
      domEditSelectionRef: { current: domSelection },
      showToast: () => {},
      writeProjectFile: async (_path: string, content: string) => void writes.push(content),
      recordEdit: async () => {},
      reloadPreview: () => {},
      handleTimelineElementsDelete: async (elements) =>
        void deleted.push(...elements.map((el) => el.id)),
      handleDomEditElementDelete: async () => {},
      previewIframeRef: { current: iframe },
      waitForPendingDomEditSaves: () => Promise.resolve(),
    });
    return null;
  }
  root = createRoot(document.createElement("div"));
  act(() => root?.render(React.createElement(Harness)));
  const openProject = (projectId: string) => {
    view.projectId = projectId;
    act(() => root?.render(React.createElement(Harness)));
  };
  return { clipboard: () => api as ReturnType<typeof useClipboard>, writes, deleted, openProject };
}

const clipOf = (id: string, tag: string, start: number, track: number): TimelineElement => ({
  id,
  domId: id,
  tag,
  start,
  duration: 2,
  track,
  authoredTrack: track,
  sourceFile: "index.html",
});
const CLIPS = [clipOf("title", "h1", 2, 0), clipOf("other", "h2", 6, 1)];

function selectClip(id: string) {
  usePlayerStore.setState({ selectedElementId: id, selectedElementIds: new Set([id]) });
}

function selectTitleClip() {
  usePlayerStore.setState({ elements: CLIPS });
  selectClip("title");
}

it("duplicates a timeline clip from a sealed preview, as saved", async () => {
  selectTitleClip();
  const { clipboard, writes } = sealedClipboard(null);
  expect(await clipboard().handleDuplicate()).toBe(true);
  expect(writes[0]?.match(/>Title<\/h1>/g)).toHaveLength(2);
  expect(writes[0]).not.toContain("display: none");
});

it("copies a timeline clip from a sealed preview, as saved", async () => {
  selectTitleClip();
  const { clipboard, writes } = sealedClipboard(null);
  expect(clipboard().handleCopy()).toBe(true);
  await clipboard().handlePaste();
  expect(writes[0]).toContain(">Title</h1>");
  expect(writes[0]).not.toContain("display: none");
});

it("copies a canvas selection from a sealed preview, as saved", async () => {
  const selection = {
    id: "title",
    selector: "#title",
    sourceFile: "index.html",
  } as DomEditSelection;
  const { clipboard, writes } = sealedClipboard(selection);
  expect(clipboard().handleCopy()).toBe(true);
  await clipboard().handlePaste();
  expect(writes[0]).toContain(">Title</h1>");
  expect(writes[0]).not.toContain("display: none");
});

it("leaves the clipboard as it was when a sealed preview lacks the element", async () => {
  const selection = { id: "gone", selector: "#gone", sourceFile: "index.html" } as DomEditSelection;
  const { clipboard, writes } = sealedClipboard(selection);
  clipboard().handleCopy();
  await clipboard().handlePaste();
  expect(writes).toEqual([]);
});

it("cuts, and duplicates, the clip selected when the key was pressed, not one selected meanwhile", async () => {
  selectTitleClip();
  const { clipboard, writes, deleted } = sealedClipboard(null);
  const cut = clipboard().handleCut();
  selectClip("other");
  expect(await cut).toBe(true);
  expect(deleted).toEqual(["title"]);
  await clipboard().handlePaste();
  expect(writes[0]?.match(/>Title<\/h1>/g)).toHaveLength(2);
  selectClip("title");
  const duplicate = clipboard().handleDuplicate();
  selectClip("other");
  expect(await duplicate).toBe(true);
  expect(writes[1]?.match(/>Title<\/h1>/g)).toHaveLength(2);
  expect(writes[1]?.match(/>Other<\/h2>/g)).toHaveLength(1);
});

it("deletes nothing when another project opened while a sealed cut waited", async () => {
  selectTitleClip();
  const { clipboard, deleted, openProject } = sealedClipboard(null);
  const cut = clipboard().handleCut();
  openProject("q");
  expect(await cut).toBe(false);
  expect(deleted).toEqual([]);
});
