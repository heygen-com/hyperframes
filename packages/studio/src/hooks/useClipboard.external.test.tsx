import { ownedElementCss } from "../utils/elementClipboardStyleBlocks";
// @vitest-environment jsdom
import React, { act } from "react";
import postcss from "postcss";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeElementClipboard } from "@hyperframes/core/element-clipboard";
import { useClipboard } from "./useClipboard";
import { usePlayerStore } from "../player";

const SOURCE =
  '<html><body><div data-composition-id="main" data-duration="2"><p id="element-1">Existing</p></div></body></html>';
let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});
function mount(readOnlyPreview = false, source = SOURCE) {
  let file = source;
  let systemText = encodeElementClipboard({
    html: '<div id="source" style="position:fixed;left:99px"><h1>Editable</h1></div>',
    css: "h1 {color:rgb(255,0,0)}",
    width: 320,
    height: 180,
    warnings: [],
  });
  const records: Array<{ files: Record<string, { before: string; after: string }> }> = [];
  const reload = vi.fn();
  const toast = vi.fn();
  const write = vi.fn(async (_path: string, content: string) => {
    file = content;
  });
  vi.stubGlobal("navigator", { clipboard: { readText: vi.fn(async () => systemText) } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ content: file }))),
  );
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  iframe.contentDocument!.body.innerHTML = source;
  let api: ReturnType<typeof useClipboard> | null = null;
  function Harness() {
    api = useClipboard({
      projectId: "p",
      activeCompPath: "index.html",
      readOnlyPreview,
      domEditSelectionRef: { current: null },
      showToast: toast,
      writeProjectFile: write,
      recordEdit: async (record) => {
        records.push(record);
      },
      reloadPreview: reload,
      handleTimelineElementsDelete: async () => {},
      handleDomEditElementDelete: async () => {},
      previewIframeRef: { current: iframe },
      waitForPendingDomEditSaves: async () => {},
    });
    return null;
  }
  root = createRoot(document.createElement("div"));
  act(() => root?.render(<Harness />));
  usePlayerStore.setState({
    currentTime: 7,
    elements: [],
    selectedElementId: null,
    selectedElementIds: new Set(),
  });
  return {
    api: () => api!,
    file: () => file,
    records,
    reload,
    toast,
    write,
    iframe,
    system: (value: string) => {
      systemText = value;
    },
  };
}

describe("system element clipboard consumer", () => {
  it("inserts an editable clip at the playhead, selects it and records a reversible saved file", async () => {
    const view = mount();
    await view.api().handlePaste();
    const doc = new DOMParser().parseFromString(view.file(), "text/html");
    const clip = doc.querySelector(".clip")!;
    expect(clip).not.toBeNull();
    expect(clip.getAttribute("data-start")).toBe("7");
    expect(clip.getAttribute("data-duration")).toBe("5");
    expect(doc.querySelector("[data-composition-id]")?.getAttribute("data-duration")).toBe("12");
    expect(clip.querySelector("h1")?.textContent).toBe("Editable");
    expect(clip.querySelector("img")).toBeNull();
    expect(clip.id).not.toBe("element-1");
    expect(clip.getAttribute("data-hf-id")).toBeTruthy();
    expect(view.records).toHaveLength(1);
    expect(view.records[0].files["index.html"]).toEqual({ before: SOURCE, after: view.file() });
    expect(usePlayerStore.getState().selectedElementId).toContain(clip.id);
    expect(usePlayerStore.getState().currentTime).toBe(7);
    expect(view.reload).toHaveBeenCalledTimes(1);
    view.iframe.contentDocument!.open();
    view.iframe.contentDocument!.write(view.file());
    view.iframe.contentDocument!.close();
    expect(view.iframe.contentDocument!.querySelector(".clip h1")?.textContent).toBe("Editable");
    await view.write("index.html", view.records[0].files["index.html"].before);
    expect(view.file()).toBe(SOURCE);
  });
  it("blocks external elements in a read-only preview even with no selection", async () => {
    const view = mount(true);
    await view.api().handlePaste();
    expect(view.write).not.toHaveBeenCalled();
    expect(view.records).toHaveLength(0);
  });
  it("leaves foreign clipboard text and failed clipboard reads harmless", async () => {
    const view = mount();
    view.system("ordinary text");
    await view.api().handlePaste();
    expect(view.write).not.toHaveBeenCalled();
    vi.stubGlobal("navigator", {
      clipboard: {
        readText: async () => {
          throw new Error("Denied");
        },
      },
    });
    await view.api().handlePaste();
    expect(view.write).not.toHaveBeenCalled();
  });
  it("remints IDs on each external paste", async () => {
    const view = mount();
    await view.api().handlePaste();
    await view.api().handlePaste();
    const doc = new DOMParser().parseFromString(view.file(), "text/html");
    const ids = Array.from(doc.querySelectorAll("[id]"), (el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(doc.querySelectorAll(".clip")).toHaveLength(2);
  });
});

it.each([
  { attribute: 'id="element-1-node-0"', existingId: "element-1-node-0" },
  { attribute: "id='element-1'", existingId: "element-1" },
  { attribute: "id=element-1", existingId: "element-1" },
  { attribute: 'ID="element-1"', existingId: "element-1" },
  { attribute: 'id="element&#45;1"', existingId: "element-1" },
])(
  "does not collide with existing HTML IDs or descendant namespaces: $attribute",
  async ({ attribute, existingId }) => {
    const view = mount(false, SOURCE.replace('id="element-1"', attribute));
    view.system(
      encodeElementClipboard({
        html: '<div id="source">Editable</div>',
        css: "#source{color:red}",
        width: 100,
        height: 50,
        warnings: [],
      }),
    );
    await view.api().handlePaste();
    const doc = new DOMParser().parseFromString(view.file(), "text/html");
    const scope = doc.querySelector(".clip")?.id;
    expect(scope).toMatch(/^element-2-[\da-f-]{36}$/);
    expect(doc.querySelector('.clip [id$="-node-0"]')?.id).toBe(`${scope}-node-0`);
    expect(doc.querySelector("style")?.textContent).toContain(`#${scope}-node-0`);
    expect(doc.querySelectorAll(`#${existingId}`)).toHaveLength(1);
  },
);

it("does not replace an existing composition font with the pasted font", async () => {
  const before = SOURCE.replace(
    "<body>",
    "<head><style>@font-face{font-family:element-2-font-0;src:local(Arial)} p{font-family:element-2-font-0}</style></head><body>",
  );
  const view = mount(false, before);
  view.system(
    encodeElementClipboard({
      html: '<div style="font-family:Test">Editable</div>',
      css: '@font-face{font-family:Test;src:url("data:font/woff2;base64,d09GMg==")}',
      width: 100,
      height: 50,
      warnings: [],
    }),
  );
  await view.api().handlePaste();
  const doc = new DOMParser().parseFromString(view.file(), "text/html");
  expect(doc.head.textContent).toContain("font-family:element-2-font-0");
  const added = Array.from(doc.querySelectorAll("style"))
    .flatMap((style) => ownedElementCss(style.textContent ?? ""))
    .map((block) => block.css)
    .join("\n");
  expect(added).toContain("font-family:");
  expect(added).not.toContain('"element-2-font-0"');
});

it.each([
  { css: "#source h1{color:red}", conditions: [] },
  { css: "@media all{#source h1{color:red}}", conditions: ["media all"] },
  {
    css: "@supports (display:block){@media all{#source h1{color:red}}}",
    conditions: ["media all", "supports (display:block)"],
  },
])(
  "duplicates an imported clip with its supported embedded styles: $css",
  async ({ css, conditions }) => {
    const view = mount();
    view.system(
      encodeElementClipboard({
        html: '<div id="source"><h1>Editable</h1></div>',
        css,
        width: 100,
        height: 50,
        warnings: [],
      }),
    );
    await view.api().handlePaste();
    const saved = new DOMParser().parseFromString(view.file(), "text/html");
    const original = saved.querySelector(".clip")!;
    view.iframe.contentDocument!.open();
    view.iframe.contentDocument!.write(view.file());
    view.iframe.contentDocument!.close();
    const element = {
      id: original.id,
      domId: original.id,
      hfId: original.getAttribute("data-hf-id")!,
      tag: "div",
      start: 7,
      duration: 5,
      track: 0,
      sourceFile: "index.html",
    };
    usePlayerStore.setState({
      elements: [element],
      selectedElementId: original.id,
      selectedElementIds: new Set([original.id]),
    });
    expect(await view.api().handleDuplicate()).toBe(true);
    const duplicated = new DOMParser().parseFromString(view.file(), "text/html");
    const title = duplicated.getElementById(`${original.id}-2`)!.querySelector("h1")!;
    const matches: string[][] = [];
    const cssText = Array.from(duplicated.querySelectorAll("style"), (style) =>
      ownedElementCss(style.textContent ?? "")
        .map((block) => block.css)
        .join("\n"),
    ).join("\n");
    postcss.parse(cssText).walkRules((rule) => {
      if (!title.matches(rule.selector)) return;
      const ancestors: string[] = [];
      for (
        let parent: postcss.Container | postcss.Document | undefined = rule.parent;
        parent;
        parent = parent.parent
      ) {
        if (parent instanceof postcss.AtRule) ancestors.push(`${parent.name} ${parent.params}`);
      }
      matches.push(ancestors);
    });
    expect(matches).toContainEqual(conditions);
    expect(view.records).toHaveLength(2);
    expect(view.records[1].files["index.html"].before).toBe(
      view.records[0].files["index.html"].after,
    );
  },
);

it.each([
  { indent: "", text: "a\nb" },
  { indent: "    ", text: "a\nb" },
  { indent: "", text: "ab" },
  { indent: "    ", text: "ab" },
])(
  "preserves imported text through save, history and reload: $indent / $text",
  async ({ indent, text }) => {
    const source = `<html><body>\n${indent}<div data-composition-id="main" data-duration="10"></div>\n</body></html>`;
    const view = mount(false, source);
    view.system(
      encodeElementClipboard({
        html: `<pre>${text}</pre>`,
        css: "",
        width: 100,
        height: 50,
        warnings: [],
      }),
    );
    await view.api().handlePaste();
    const saved = new DOMParser().parseFromString(view.file(), "text/html");
    expect(saved.querySelector("pre")?.textContent).toBe(text);
    expect(
      new DOMParser()
        .parseFromString(view.records[0].files["index.html"].after, "text/html")
        .querySelector("pre")?.textContent,
    ).toBe(text);
    view.iframe.contentDocument!.open();
    view.iframe.contentDocument!.write(view.file());
    view.iframe.contentDocument!.close();
    expect(view.iframe.contentDocument!.querySelector("pre")?.textContent).toBe(text);
    await view.write("index.html", view.records[0].files["index.html"].before);
    expect(view.file()).toBe(source);
  },
);
