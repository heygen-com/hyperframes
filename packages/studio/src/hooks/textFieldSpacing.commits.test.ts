// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { patchElementInHtml } from "@hyperframes/studio-server/source-mutation";
import { resolveDomEditSelection } from "../components/editor/domEditingLayers";
import { resolveFoundSelection } from "../components/editor/previewSelection";
import type { DomEditSelection } from "../components/editor/domEditing";
import { flushStudioPendingEdits } from "../utils/studioPendingEdits";
import type { PersistDomEditOperations } from "./domEditCommitTypes";
import { useDomEditTextCommits } from "./useDomEditTextCommits";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PATH = "index.html";
const OPTIONS = { activeCompositionPath: PATH, isMasterView: false, skipSourceProbe: true };
const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** A heading saved through the real source patcher and edited from the panel or canvas, drawn from the file. */
function heading(markup: string) {
  let file = `<h1 id="title">${markup}</h1>`;
  let failNextSave = false;
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const draw = () => {
    iframe.contentDocument!.body.innerHTML = file;
    return iframe.contentDocument!.getElementById("title")!;
  };
  const persist = vi.fn<PersistDomEditOperations>(async (sel, operations, options) => {
    if (failNextSave) {
      failNextSave = false;
      throw new Error("the save did not reach the file");
    }
    if (options?.shouldSave?.() === false) return;
    file = patchElementInHtml(file, { id: sel.id }, operations).html;
  });
  let commits!: ReturnType<typeof useDomEditTextCommits>;
  let root: Root | null = null;
  const render = (selection: DomEditSelection) => {
    function Harness() {
      commits = useDomEditTextCommits({
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
      return null;
    }
    root ??= createRoot(document.createElement("div"));
    act(() => root!.render(createElement(Harness)));
  };
  cleanups.push(() => act(() => root?.unmount()));
  const panel = async () => {
    const selection = (await resolveDomEditSelection(draw(), OPTIONS))!;
    render(selection);
    return { selection, commits };
  };
  const settle = () => act(() => flushStudioPendingEdits());
  const shown = () =>
    new DOMParser()
      .parseFromString(file, "text/html")
      .getElementById("title")!
      .innerHTML.replace(/ (data-hf-[a-z-]+|style)="[^"]*"/g, "");
  return {
    panel,
    settle,
    shown,
    file: () => file,
    setFile: (next: string) => void (file = next),
    failNextSave: () => void (failNextSave = true),
    remount: () => {
      act(() => root?.unmount());
      root = null;
    },
    async add(after: string) {
      const { commits: hook } = await panel();
      let key: string | null = null;
      await act(async () => void (key = await hook.handleDomAddTextField(after)));
      await settle();
      return key!;
    },
    async type(key: string, value: string) {
      const { selection, commits: hook } = await panel();
      await act(() => hook.handleDomTextCommitForSelection(selection, value, key).then(() => {}));
      await settle();
    },
    async remove(key: string) {
      const { commits: hook } = await panel();
      await act(() => hook.handleDomRemoveTextField(key));
      await settle();
    },
    async onCanvas(edit: (html: string) => string) {
      const { commits: hook } = await panel();
      const element = iframe.contentDocument!.getElementById("title")!;
      const previousHtml = element.innerHTML;
      const html = edit(previousHtml);
      element.innerHTML = html;
      await act(() => hook.handleDomRichTextCommit({ element, html, previousHtml }));
      await settle();
    },
  };
}

const replaceAdded = (value: string) => (html: string) =>
  html.replace(/(data-hf-text-key="child:new:[^"]*"[^>]*>)New text</, `$1${value}<`);

describe("a text layer added from the panel", () => {
  it("is saved apart from the words on both sides between two spaced words", async () => {
    const title = heading("<span>First</span> <span>Second</span>");
    await title.add("child:0:span");
    expect(title.shown()).toBe("<span>First</span> <span>New text</span> <span>Second</span>");
  });

  // fails without the fix: Add wrote no separator after the new layer either, saving 'First New textSecond'.
  it("is saved apart from the words on both sides between two joined layers", async () => {
    const title = heading("<span>First</span><span>Second</span>");
    await title.add("child:0:span");
    expect(title.shown()).toBe("<span>First</span> <span>New text</span> <span>Second</span>");
  });

  it("takes no space before a value typed in the panel that starts with punctuation", async () => {
    const title = heading("<span>First</span> <span>Second</span>");
    const key = await title.add("child:0:span");
    await title.type(key, ", again");
    expect(title.shown()).toBe("<span>First</span><span>, again</span> <span>Second</span>");
  });

  it.each([
    ["a word", "Again", "<span>First</span> <span>Again</span> <span>Second</span>"],
    ["punctuation", ", again", "<span>First</span><span>, again</span> <span>Second</span>"],
  ])(
    "is spaced the same when its text is replaced on the canvas with %s",
    async (_, typed, saved) => {
      const title = heading("<span>First</span> <span>Second</span>");
      await title.add("child:0:span");
      await title.onCanvas(replaceAdded(typed));
      expect(title.shown()).toBe(saved);
    },
  );

  it("is spaced from the file after Studio remounts between the add and the first value", async () => {
    const title = heading("<span>First</span>");
    const key = await title.add("child:0:span");
    title.remount();
    await title.type(key, "again");
    expect(title.shown()).toBe("<span>First</span> <span>again</span>");
  });

  it("is spaced when its first value is saved again after a failed save", async () => {
    const title = heading("<span>First</span>");
    const key = await title.add("child:0:span");
    title.failNextSave();
    await title.type(key, ", again");
    await title.type(key, ", again");
    expect(title.shown()).toBe("<span>First</span><span>, again</span>");
  });

  it("is spaced when its first value is undone and typed again", async () => {
    const title = heading("<span>First</span>");
    const key = await title.add("child:0:span");
    const afterAdd = title.file();
    await title.type(key, ", again");
    title.setFile(afterAdd);
    await title.type(key, "again");
    expect(title.shown()).toBe("<span>First</span> <span>again</span>");
  });

  // fails without the fix: the reloaded run read as 'First ', and saving 'First!' joined it to the new layer.
  it("keeps its separator after a plain-text run whose words are edited after a reload", async () => {
    const title = heading("First <span>Second</span>");
    await title.add("text-node:0");
    await title.type("text-node:0", "First!");
    expect(title.shown()).toBe("First! <span>New text</span> <span>Second</span>");
  });

  it.each([
    ["two spaced words", "<span>First</span> <span>Second</span>"],
    ["two joined layers", "<span>First</span><span>Second</span>"],
  ])("leaves %s exactly as they were when it is removed", async (_, markup) => {
    const title = heading(markup);
    const key = await title.add("child:0:span");
    await title.remove(key);
    expect(title.shown()).toBe(markup);
  });

  it("takes no space after an opening parenthesis", async () => {
    const title = heading("<span>(</span><span>Second)</span>");
    const key = await title.add("child:0:span");
    await title.type(key, "Again");
    expect(title.shown()).toBe("<span>(</span><span>Again</span> <span>Second)</span>");
  });

  it("keeps a separator the person deleted on the canvas deleted through later saves", async () => {
    const title = heading("<span>First</span> <span>Second</span>");
    const key = await title.add("child:0:span");
    await title.onCanvas((html) => html.replace(/<\/span> (<span[^>]*child:new)/, "</span>$1"));
    expect(title.shown()).toBe("<span>First</span><span>New text</span> <span>Second</span>");
    await title.type(key, "again");
    await title.type("child:0:span", "Firsts");
    expect(title.shown()).toBe("<span>Firsts</span><span>again</span> <span>Second</span>");
  });

  it.each([
    ["Chinese", "<span>你好</span>", "<span>你好</span><span>世界</span>"],
    ["Korean", "<span>안녕</span>", "<span>안녕</span> <span>세계</span>"],
  ])("follows %s word spacing", async (_, markup, saved) => {
    const title = heading(markup);
    const key = await title.add("child:0:span");
    await title.type(key, saved.includes("世界") ? "世界" : "세계");
    expect(title.shown()).toBe(saved);
  });

  it("spaces a second layer added after the first, and stays tidy when the first is removed", async () => {
    let clock = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => (clock += 1));
    const title = heading("<span>First</span>");
    const one = await title.add("child:0:span");
    await title.add(one);
    expect(title.shown()).toBe("<span>First</span> <span>New text</span> <span>New text</span>");
    await title.remove(one);
    expect(title.shown()).toBe("<span>First</span> <span>New text</span>");
  });

  // fails without the fix: the first layer kept owning a separator the second had moved, and the last removal left it.
  it.each([
    ["first then second", (one: string, two: string) => [one, two]],
    ["second then first", (one: string, two: string) => [two, one]],
  ])(
    "leaves joined layers joined when two layers added between them are removed %s",
    async (_, order) => {
      let clock = Date.now();
      vi.spyOn(Date, "now").mockImplementation(() => (clock += 1));
      const title = heading("<span>First</span><span>Second</span>");
      const one = await title.add("child:0:span");
      const two = await title.add(one);
      expect(title.shown()).toBe(
        "<span>First</span> <span>New text</span> <span>New text</span> <span>Second</span>",
      );
      const [a, b] = order(one, two);
      await title.remove(a!);
      expect(title.shown()).toBe("<span>First</span> <span>New text</span> <span>Second</span>");
      await title.remove(b!);
      expect(title.shown()).toBe("<span>First</span><span>Second</span>");
    },
  );

  // fails without the fix: a nonbreaking space typed over Studio's separator was saved back as a plain space.
  it("keeps a nonbreaking space the person typed over its separator on the canvas", async () => {
    const title = heading("<span>First</span><span>Second</span>");
    const key = await title.add("child:0:span");
    await title.onCanvas((html) =>
      html.replace(/<\/span> (<span[^>]*child:new)/, "</span>\u00a0$1"),
    );
    expect(title.shown()).toBe("<span>First</span>&nbsp;<span>New text</span> <span>Second</span>");
    await title.type(key, "again");
    expect(title.shown()).toBe("<span>First</span>&nbsp;<span>again</span> <span>Second</span>");
  });
});
