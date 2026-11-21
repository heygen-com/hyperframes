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
function sealedClipboard(domSelection: DomEditSelection | null, scriptMade = "", saved = SAVED) {
  const preview = new DOMParser().parseFromString(ensureHfIds(saved), "text/html");
  document.body.innerHTML = preview.body.innerHTML;
  document.querySelector("[data-composition-id]")!.insertAdjacentHTML("beforeend", scriptMade);
  document.getElementById("title")!.style.cssText = "visibility: hidden; display: none";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ content: saved }))),
  );
  const { iframe } = sealedPreviewFrame();
  const writes: string[] = [];
  const deleted: string[] = [];
  const toasts: string[] = [];
  const view = { projectId: "p" };
  let api: ReturnType<typeof useClipboard> | null = null;
  function Harness() {
    api = useClipboard({
      projectId: view.projectId,
      activeCompPath: "index.html",
      domEditSelectionRef: { current: domSelection },
      showToast: (message: string) => void toasts.push(message),
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
  return {
    clipboard: () => api as ReturnType<typeof useClipboard>,
    writes,
    deleted,
    toasts,
    openProject,
  };
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

// Elements the preview's own script made: not in the saved file, so a copy takes the preview's markup.
const SCRIPT_MADE = [
  ['<div id="made" class="clip" onclick="alert(1)">Made</div>', true],
  ['<a id="made" class="clip" href="javascript:alert(1)">Made</a>', true],
  ['<div id="made" class="clip"><script>alert(1)</script>Made</div>', true],
  ['<iframe id="made" class="clip" srcdoc="<b>x</b>"></iframe>', true],
  ['<video id="made" class="clip" src="clip.mp4" data-start="1" data-duration="2"></video>', false],
] as const;

it("pastes a sealed preview's own element only when its markup runs no code", async () => {
  for (const [markup, refused] of SCRIPT_MADE) {
    const selection = {
      id: "made",
      selector: "#made",
      sourceFile: "index.html",
    } as DomEditSelection;
    const { clipboard, writes, toasts } = sealedClipboard(selection, markup);
    expect(clipboard().handleCopy()).toBe(true);
    await clipboard().handlePaste();
    if (refused) {
      expect(writes).toEqual([]);
      expect(toasts.at(-1)).toMatch(/^Couldn't paste/);
    } else {
      expect(writes[0]).toContain('src="clip.mp4"');
    }
    act(() => root?.unmount());
    root = null;
  }
});

it("pastes and duplicates a saved element with its own handler, as saved", async () => {
  const saved = SAVED.replace(
    "</div></body>",
    '<button id="go" class="clip" onclick="next()" data-start="1" data-duration="1" data-track-index="2">Go</button>\n</div></body>',
  );
  const selection = { id: "go", selector: "#go", sourceFile: "index.html" } as DomEditSelection;
  const pasted = sealedClipboard(selection, "", saved);
  expect(pasted.clipboard().handleCopy()).toBe(true);
  await pasted.clipboard().handlePaste();
  expect(pasted.writes[0]?.match(/onclick="next\(\)"/g)).toHaveLength(2);
  act(() => root?.unmount());
  root = null;

  usePlayerStore.setState({ elements: [clipOf("go", "button", 1, 2)] });
  selectClip("go");
  const duplicated = sealedClipboard(null, "", saved);
  expect(await duplicated.clipboard().handleDuplicate()).toBe(true);
  expect(duplicated.writes[0]?.match(/onclick="next\(\)"/g)).toHaveLength(2);
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
