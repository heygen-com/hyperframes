// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useClipboard } from "./useClipboard";
import { usePlayerStore, type TimelineElement } from "../player";
import type { DomEditSelection } from "../components/editor/domEditing";

const SAVED = `<!doctype html><html><body>
<div data-composition-id="main" data-start="0" data-duration="10">
<h1 data-hf-id="hf-title" id="title" class="clip" data-start="2" data-duration="3" data-track-index="0">Title</h1>
</div></body></html>`;

// What the runtime leaves on a clip while the playhead is before its start.
const RUNTIME_HIDE = "visibility: hidden; display: none; position: absolute";

const TITLE: TimelineElement = {
  id: "title",
  domId: "title",
  hfId: "hf-title",
  tag: "h1",
  start: 2,
  duration: 3,
  track: 0,
  authoredTrack: 0,
  sourceFile: "index.html",
};

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function mountClipboard(domSelection: DomEditSelection | null = null) {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument as Document;
  doc.open();
  doc.write(SAVED);
  doc.close();
  (doc.getElementById("title") as HTMLElement).style.cssText = RUNTIME_HIDE;
  const file = { content: SAVED };
  vi.stubGlobal(
    "fetch",
    // The server answers later, so a write that lands first is what the read sees.
    vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      return new Response(JSON.stringify({ content: file.content }));
    }),
  );
  const writes: string[] = [];
  const deleted: string[] = [];
  let api: ReturnType<typeof useClipboard> | null = null;
  function Harness() {
    api = useClipboard({
      projectId: "p",
      activeCompPath: "index.html",
      domEditSelectionRef: { current: domSelection },
      showToast: () => {},
      writeProjectFile: async (_path, content) => {
        writes.push(content);
      },
      recordEdit: async () => {},
      reloadPreview: () => {},
      handleTimelineElementsDelete: async (elements) => {
        deleted.push(...elements.map((el) => el.id));
        file.content = SAVED.replace(/<h1[\s\S]*<\/h1>/, "");
      },
      handleDomEditElementDelete: async () => {},
      previewIframeRef: { current: iframe },
    });
    return null;
  }
  root = createRoot(document.createElement("div"));
  act(() => root?.render(React.createElement(Harness)));
  return { clipboard: () => api as ReturnType<typeof useClipboard>, writes, deleted };
}

function selectTitle() {
  usePlayerStore.setState({
    elements: [TITLE],
    selectedElementId: "title",
    selectedElementIds: new Set(["title"]),
    currentTime: 6,
  });
}

function clearSelection() {
  usePlayerStore.setState({ selectedElementId: null, selectedElementIds: new Set() });
}

describe("copy takes a clip's saved markup, not the runtime's live styling", () => {
  it("pastes a timeline clip copied while hidden without the runtime's hide", async () => {
    selectTitle();
    const { clipboard, writes } = mountClipboard();
    expect(clipboard().handleCopy()).toBe(true);
    await clipboard().handlePaste();
    expect(writes).toHaveLength(1);
    expect(writes[0]).not.toContain("display: none");
    expect(writes[0]).not.toContain("visibility: hidden");
  });

  it("pastes a copied element without the runtime's hide", async () => {
    clearSelection();
    const selection = {
      hfId: "hf-title",
      id: "title",
      selector: "#title",
      selectorIndex: 0,
      sourceFile: "index.html",
    } as DomEditSelection;
    const { clipboard, writes } = mountClipboard(selection);
    expect(clipboard().handleCopy()).toBe(true);
    await clipboard().handlePaste();
    expect(writes).toHaveLength(1);
    expect(writes[0]).not.toContain("display: none");
  });

  it("cuts only once the saved markup is read, and pastes it", async () => {
    selectTitle();
    const { clipboard, writes, deleted } = mountClipboard();
    await clipboard().handleCut();
    expect(deleted).toEqual(["title"]);
    await clipboard().handlePaste();
    expect(writes[0]).not.toContain("display: none");
  });
});
