import { ownedElementCss } from "../utils/elementClipboardStyleBlocks";
// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { inlineSubCompositions } from "../../../core/src/compiler/inlineSubCompositions";
import { encodeElementClipboard } from "@hyperframes/core/element-clipboard";
import { useClipboard } from "./useClipboard";
import { usePlayerStore } from "../player";

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

it("isolates parent and child pasted styles after the compiler inlines both compositions", async () => {
  const files: Record<string, string> = {
    "index.html":
      '<html><body><div data-composition-id="main" data-duration="10"><div data-composition-id="sub" data-composition-src="compositions/sub.html" data-start="0" data-duration="10"></div></div></body></html>',
    "compositions/sub.html":
      '<html><body><div data-composition-id="sub" data-duration="10"></div></body></html>',
  };
  let path = "index.html";
  let systemText = "";
  vi.stubGlobal("navigator", { clipboard: { readText: async () => systemText } });
  vi.stubGlobal("fetch", async (url: string) => {
    const file = decodeURIComponent(String(url).split("/files/")[1] ?? "");
    return new Response(JSON.stringify({ content: files[file] }));
  });
  let clipboard: ReturnType<typeof useClipboard> | undefined;
  function Harness() {
    clipboard = useClipboard({
      projectId: "p",
      activeCompPath: path,
      domEditSelectionRef: { current: null },
      showToast: () => {},
      writeProjectFile: async (file, content) => {
        files[file] = content;
      },
      recordEdit: async () => {},
      reloadPreview: () => {},
      handleTimelineElementsDelete: async () => {},
      handleDomEditElementDelete: async () => {},
      previewIframeRef: { current: null },
      waitForPendingDomEditSaves: async () => {},
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    act(() => root.render(<Harness />));
    usePlayerStore.setState({
      currentTime: 0,
      elements: [],
      selectedElementId: null,
      selectedElementIds: new Set(),
    });
    systemText = encodeElementClipboard({
      html: '<div id="parent"><h1>Parent</h1></div>',
      css: "#parent h1{color:red}",
      width: 100,
      height: 50,
      warnings: [],
    });
    await clipboard!.handlePaste();
    const parent = parse(files[path]!);
    const parentStyle = Array.from(parent.querySelectorAll("style"))
      .flatMap((style) => ownedElementCss(style.textContent ?? ""))
      .map((block) => block.css)
      .join("\n");
    path = "compositions/sub.html";
    act(() => root.render(<Harness />));
    systemText = encodeElementClipboard({
      html: '<div id="child"><h1>Child</h1></div>',
      css: "h1{color:blue}",
      width: 100,
      height: 50,
      warnings: [],
    });
    await clipboard!.handlePaste();

    const host = parent.querySelector("[data-composition-src]")!;
    const assembled = inlineSubCompositions(parent, [host], {
      resolveHtml: () => files["compositions/sub.html"]!,
      parseHtml: parse,
    });
    for (const style of assembled.styles) {
      const element = parent.createElement("style");
      element.textContent = style.css;
      parent.head.append(element);
    }
    const parentTitle = parent.querySelector("h1")!;
    const childTitle = host.querySelector("h1")!;
    expect(parentTitle.textContent).toBe("Parent");
    expect(childTitle.textContent).toBe("Child");
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(parentStyle);
    const selectors = Array.from(sheet.cssRules).flatMap((rule) =>
      rule instanceof CSSStyleRule ? [rule.selectorText] : [],
    );
    expect(selectors.some((selector) => parentTitle.matches(selector))).toBe(true);
    expect(selectors.some((selector) => childTitle.matches(selector))).toBe(false);
    const ids = Array.from(parent.querySelectorAll("[id]"), (element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  } finally {
    act(() => root.unmount());
  }
});
