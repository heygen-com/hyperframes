// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ensureHfIds } from "@hyperframes/parsers/hf-ids";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useClipboard } from "./useClipboard";
import { usePlayerStore, type TimelineElement } from "../player";
import type { DomEditSelection } from "../components/editor/domEditing";
import { serializeStudioFileMutations } from "../utils/studioFileMutationCoordinator";

// Saved without hf-ids and with no element id: the preview stamps ids only in memory.
const SAVED = `<!doctype html><html><body>
<div data-composition-id="main" data-start="0" data-duration="10">
<h1 class="clip" data-start="2" data-duration="3" data-track-index="0">Title</h1>
</div></body></html>`;

const SUB = `<template id="sub-template"><div data-composition-id="sub" data-start="0" data-duration="4">
<h2 class="clip" data-start="1" data-duration="2" data-track-index="0">Sub</h2>
</div></template>`;

// What the runtime leaves on a clip while the playhead is before its start.
const RUNTIME_HIDE = "visibility: hidden; display: none; position: absolute";

function stampedHfId(source: string, selector: string): string {
  const doc = new DOMParser().parseFromString(ensureHfIds(source), "text/html");
  const roots = [doc, ...Array.from(doc.querySelectorAll("template"), (t) => t.content)];
  const el = roots.map((root) => root.querySelector(selector)).find(Boolean);
  return el?.getAttribute("data-hf-id") ?? "";
}

const TITLE_HF_ID = stampedHfId(SAVED, "h1");
const SUB_HF_ID = stampedHfId(SUB, "h2");

const TITLE: TimelineElement = {
  id: TITLE_HF_ID,
  hfId: TITLE_HF_ID,
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

// The preview page: the saved markup with the preview's in-memory ids, a sub-composition
// mounted inline, and the runtime's hide on both clips.
function mountPreview(sub: string, bundle: (host: Element) => void): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument as Document;
  doc.open();
  doc.write(ensureHfIds(SAVED));
  doc.close();
  const parsed = new DOMParser().parseFromString(ensureHfIds(sub), "text/html");
  const subRoot = (parsed.querySelector("template") as HTMLTemplateElement).content
    .firstElementChild;
  const host = doc.createElement("div");
  host.setAttribute("data-composition-src", "compositions/sub.html");
  host.append(doc.importNode(subRoot as Element, true));
  bundle(host);
  doc.querySelector('[data-composition-id="main"]')?.append(host);
  for (const clip of doc.querySelectorAll(".clip"))
    (clip as HTMLElement).style.cssText = RUNTIME_HIDE;
  return iframe;
}

function stubFiles(
  files: Record<string, string>,
  fail: { on: boolean },
  delayMs: Record<string, number>,
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = decodeURIComponent(String(url).split("/files/")[1] ?? "");
      // The server answers later, so a write that lands first is what the read sees.
      await new Promise((resolve) => setTimeout(resolve, delayMs[path] ?? 0));
      if (fail.on) return new Response("", { status: 500 });
      return new Response(JSON.stringify({ content: files[path] }));
    }),
  );
}

function mountClipboard(
  domSelection: DomEditSelection | null = null,
  sub = SUB,
  bundle: (host: Element) => void = () => {},
) {
  const files: Record<string, string> = { "index.html": SAVED, "compositions/sub.html": sub };
  const fail = { on: false };
  const delayMs: Record<string, number> = {};
  const domEditSave = { pending: Promise.resolve() };
  const domSelectionRef = { current: domSelection };
  stubFiles(files, fail, delayMs);
  const iframe = mountPreview(sub, bundle);
  const writes: string[] = [];
  const deleted: string[] = [];
  const writeProjectFile = async (_path: string, content: string) => {
    writes.push(content);
  };
  let api: ReturnType<typeof useClipboard> | null = null;
  function Harness() {
    api = useClipboard({
      projectId: "p",
      activeCompPath: "index.html",
      domEditSelectionRef: domSelectionRef,
      showToast: () => {},
      writeProjectFile,
      recordEdit: async () => {},
      reloadPreview: () => {},
      handleTimelineElementsDelete: async (elements) => {
        deleted.push(...elements.map((el) => el.id));
        files["index.html"] = SAVED.replace(/<h1[\s\S]*<\/h1>/, "");
      },
      handleDomEditElementDelete: async () => {},
      previewIframeRef: { current: iframe },
      waitForPendingDomEditSaves: () => domEditSave.pending,
    });
    return null;
  }
  root = createRoot(document.createElement("div"));
  act(() => root?.render(React.createElement(Harness)));
  const clipboard = () => api as ReturnType<typeof useClipboard>;
  return {
    clipboard,
    writes,
    deleted,
    files,
    fail,
    writeProjectFile,
    iframe,
    delayMs,
    domEditSave,
    domSelectionRef,
  };
}

function selectTitle() {
  usePlayerStore.setState({
    elements: [TITLE],
    selectedElementId: TITLE.id,
    selectedElementIds: new Set([TITLE.id]),
    currentTime: 6,
  });
}

function clearSelection() {
  usePlayerStore.setState({ selectedElementId: null, selectedElementIds: new Set() });
}

describe("copy takes a clip's saved markup, not the runtime's live styling", () => {
  it("pastes a timeline clip copied while hidden, matched through the preview's hf-id", async () => {
    selectTitle();
    const { clipboard, writes } = mountClipboard();
    expect(clipboard().handleCopy()).toBe(true);
    await clipboard().handlePaste();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain(">Title</h1>");
    expect(writes[0]).not.toContain("display: none");
    expect(writes[0]).not.toContain("visibility: hidden");
  });

  it("pastes a sub-composition clip copied while hidden, found inside its template", async () => {
    clearSelection();
    const selection = {
      hfId: SUB_HF_ID,
      selector: "h2",
      selectorIndex: 0,
      sourceFile: "compositions/sub.html",
    } as DomEditSelection;
    const { clipboard, writes } = mountClipboard(selection);
    expect(clipboard().handleCopy()).toBe(true);
    await clipboard().handlePaste();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain(">Sub</h2>");
    expect(writes[0]).not.toContain("display: none");
  });

  it("cuts only once the saved markup is read, and pastes it", async () => {
    selectTitle();
    const { clipboard, writes, deleted } = mountClipboard();
    await clipboard().handleCut();
    expect(deleted).toEqual([TITLE.id]);
    await clipboard().handlePaste();
    expect(writes[0]).toContain(">Title</h1>");
    expect(writes[0]).not.toContain("display: none");
  });

  it("reads a save still in flight when the copy starts", async () => {
    selectTitle();
    const { clipboard, writes, files, writeProjectFile } = mountClipboard();
    void serializeStudioFileMutations(writeProjectFile, ["index.html"], async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      // The host pins hf-ids on disk, so a Studio save keeps the clip's id.
      files["index.html"] = ensureHfIds(SAVED).replace(">Title<", ">Title v2<");
    });
    clipboard().handleCopy();
    await clipboard().handlePaste();
    expect(writes[0]?.match(/>Title v2<\/h1>/g)).toHaveLength(2);
    expect(writes[0]).not.toContain(">Title</h1>");
  });

  it("finds a clip by its id once its saved markup no longer hashes to the preview's hf-id", async () => {
    selectTitle();
    const { clipboard, writes, files, iframe } = mountClipboard();
    iframe.contentDocument?.querySelector("h1")?.setAttribute("id", "title");
    files["index.html"] = SAVED.replace("<h1 ", '<h1 id="title" ').replace(">Title<", ">Title v2<");
    clipboard().handleCopy();
    await clipboard().handlePaste();
    expect(writes[0]?.match(/>Title v2<\/h1>/g)).toHaveLength(2);
    expect(writes[0]).not.toContain("display: none");
  });
});

const SUB_SELECTION = {
  hfId: SUB_HF_ID,
  selector: "h2",
  selectorIndex: 0,
  sourceFile: "compositions/sub.html",
} as DomEditSelection;

describe("copy of a sub-composition clip", () => {
  it("rebases its relative asset paths to the project root, as the preview does", async () => {
    clearSelection();
    const sub = SUB.replace(
      ">Sub<",
      '><img src="../assets/logo.png?v=2"><img src="logo.png"><img src="assets/shared.png">' +
        '<img src="../assets/100%.png"><span style="background: url(\'../fonts/My Font.woff2\')"></span>Sub<',
    );
    const selection = { ...SUB_SELECTION, hfId: stampedHfId(sub, "h2") };
    const { clipboard, writes } = mountClipboard(selection, sub, (host) => {
      const [up, sibling] = Array.from(host.querySelectorAll("img"));
      up?.setAttribute("src", "assets/logo.png?v=2");
      sibling?.setAttribute("src", "compositions/logo.png");
    });
    clipboard().handleCopy();
    await clipboard().handlePaste();
    expect(writes[0]).toContain('src="assets/logo.png?v=2"');
    expect(writes[0]).toContain('src="compositions/logo.png"');
    expect(writes[0]).toContain('src="assets/shared.png"');
    expect(writes[0]).toContain('src="assets/100%.png"');
    expect(writes[0]).toContain("url('fonts/My Font.woff2')");
    expect(writes[0]).not.toContain("../");
    expect(writes[0]).not.toContain("display: none");
  });
});

describe("copy order", () => {
  it("waits for a DOM edit save still in flight", async () => {
    selectTitle();
    const { clipboard, writes, files, domEditSave } = mountClipboard();
    domEditSave.pending = new Promise((resolve) =>
      setTimeout(() => {
        files["index.html"] = ensureHfIds(SAVED).replace(">Title<", ">Title v2<");
        resolve();
      }, 5),
    );
    clipboard().handleCopy();
    await clipboard().handlePaste();
    expect(writes[0]?.match(/>Title v2<\/h1>/g)).toHaveLength(2);
  });

  it("still copies after a DOM edit save failed", async () => {
    selectTitle();
    const { clipboard, writes, domEditSave } = mountClipboard();
    domEditSave.pending = Promise.reject(new Error("save conflict"));
    domEditSave.pending.catch(() => {});
    clipboard().handleCopy();
    await clipboard().handlePaste();
    expect(writes[0]?.match(/>Title<\/h1>/g)).toHaveLength(2);
  });

  it("pastes the second of two copies", async () => {
    selectTitle();
    const { clipboard, writes, domSelectionRef } = mountClipboard();
    clipboard().handleCopy();
    await new Promise((resolve) => setTimeout(resolve, 10));
    clearSelection();
    domSelectionRef.current = SUB_SELECTION;
    clipboard().handleCopy();
    await clipboard().handlePaste();
    expect(writes[0]).toContain(">Sub</h2>");
    expect(writes[0]?.match(/>Title<\/h1>/g)).toHaveLength(1);
  });

  it("pastes the later copy even when the earlier copy's read lands last", async () => {
    selectTitle();
    const { clipboard, writes, delayMs, domSelectionRef } = mountClipboard();
    delayMs["index.html"] = 20;
    clipboard().handleCopy();
    clearSelection();
    domSelectionRef.current = SUB_SELECTION;
    clipboard().handleCopy();
    await new Promise((resolve) => setTimeout(resolve, 40));
    delayMs["index.html"] = 0;
    await clipboard().handlePaste();
    expect(writes[0]).toContain(">Sub</h2>");
    expect(writes[0]?.match(/>Title<\/h1>/g)).toHaveLength(1);
  });

  it("duplicates a hidden clip with its saved markup", async () => {
    selectTitle();
    const { clipboard, writes } = mountClipboard();
    await clipboard().handleDuplicate();
    expect(writes[0]?.match(/>Title<\/h1>/g)).toHaveLength(2);
    expect(writes[0]).not.toContain("display: none");
  });
});

describe("a copy that fails", () => {
  it("leaves the previous copy on the clipboard", async () => {
    selectTitle();
    const { clipboard, writes, fail } = mountClipboard();
    clipboard().handleCopy();
    await new Promise((resolve) => setTimeout(resolve, 10));
    fail.on = true;
    clipboard().handleCopy();
    await new Promise((resolve) => setTimeout(resolve, 10));
    fail.on = false;
    await clipboard().handlePaste();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain(">Title</h1>");
  });

  it("deletes nothing on a cut", async () => {
    selectTitle();
    const { clipboard, deleted, fail } = mountClipboard();
    fail.on = true;
    expect(await clipboard().handleCut()).toBe(false);
    expect(deleted).toEqual([]);
  });
});
