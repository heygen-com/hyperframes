// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ensureHfIds } from "@hyperframes/parsers/hf-ids";
import { runtimeProtocolMetadata } from "@hyperframes/core/runtime/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { useElementPicker } from "./useElementPicker";

// As the host leaves it on disk: hf-ids pinned, no element ids.
const SAVED = ensureHfIds(`<!doctype html><html><body>
<div data-composition-id="main" data-start="0" data-duration="10">
<h1 class="clip" data-start="2" data-duration="3" data-track-index="0">Title</h1>
</div></body></html>`);

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

// The preview page: the saved markup plus what the runtime adds to it.
function mountPreview(mounted = ""): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument as Document;
  doc.open();
  doc.write(SAVED);
  doc.close();
  (doc.querySelector("h1") as HTMLElement).style.cssText = "visibility: hidden; display: none";
  doc.body.append(Object.assign(doc.createElement("script"), { textContent: "/* runtime */" }));
  doc.body.insertAdjacentHTML("beforeend", mounted);
  return iframe;
}

function mountPicker(files: Record<string, string>, selector = "h1", mounted = "") {
  const iframe = mountPreview(mounted);
  const synced: Record<string, string>[] = [];
  let api: ReturnType<typeof useElementPicker> | null = null;
  let setHostFiles: (next: Record<string, string>) => void = () => {};
  // Like a Studio host: it holds the files in state and rerenders after each write.
  function Harness() {
    const [workspaceFiles, setFiles] = useState(files);
    setHostFiles = setFiles;
    api = useElementPicker(
      { current: iframe },
      {
        workspaceFiles,
        onSyncFiles: (changed) => {
          synced.push(changed);
          setFiles((prev) => ({ ...prev, ...changed }));
        },
      },
    );
    return null;
  }
  root = createRoot(document.createElement("div"));
  act(() => root?.render(React.createElement(Harness)));
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: iframe.contentWindow,
        data: {
          source: "hf-preview",
          type: "element-picked",
          elementInfo: { selector, tagName: "h1" },
          ...runtimeProtocolMetadata(30),
        },
      }),
    );
  });
  const picker = () => api as ReturnType<typeof useElementPicker>;
  return {
    picker,
    synced,
    setHostFiles: (next: Record<string, string>) => act(() => setHostFiles(next)),
  };
}

describe("an edit to a picked element without an id", () => {
  it("writes only that edit into the saved file", () => {
    const { picker, synced } = mountPicker({ "index.html": SAVED });
    expect(picker().pickedElement?.selector).toBe("h1");
    act(() => picker().setStyle("color", "red"));
    expect(synced).toHaveLength(1);
    const written = synced[0]?.["index.html"] ?? "";
    expect(written).toMatch(/<h1 [^>]*style="color: red"[^>]*>Title<\/h1>/);
    expect(written).not.toContain("display: none");
    expect(written).not.toContain("/* runtime */");
  });

  it("persists a text edit", () => {
    const { picker, synced } = mountPicker({ "index.html": SAVED });
    act(() => picker().setTextContent("Hello"));
    expect(synced[0]?.["index.html"]).toMatch(/>Hello<\/h1>/);
  });

  // The same h1 in index.html and compositions/b.html, so both carry one hf-id.
  const SUB = ensureHfIds(`<template><div data-composition-id="b">
<h1 class="clip" data-start="2" data-duration="3" data-track-index="0">Title</h1>
</div></template>`);
  const subH1 = new DOMParser()
    .parseFromString(SUB, "text/html")
    .querySelector("template")
    ?.content.querySelector("h1");
  const host = `<div data-composition-file="compositions/b.html">${subH1?.outerHTML}</div>`;

  it.each([
    ["index.html first", { "index.html": SAVED, "compositions/b.html": SUB }],
    ["the sub-composition first", { "compositions/b.html": SUB, "index.html": SAVED }],
  ])("writes a twin element into its own file (%s)", (_order, files) => {
    expect(SAVED).toContain(`data-hf-id="${subH1?.getAttribute("data-hf-id")}"`);
    const inSub = mountPicker(files, "[data-composition-file] h1", host);
    act(() => inSub.picker().setStyle("color", "red"));
    expect(inSub.synced.map((changed) => Object.keys(changed))).toEqual([["compositions/b.html"]]);
    act(() => root?.unmount());
    const inRoot = mountPicker(files, "h1", host);
    act(() => inRoot.picker().setStyle("color", "red"));
    expect(inRoot.synced.map((changed) => Object.keys(changed))).toEqual([["index.html"]]);
  });

  it("keeps both of two edits made before the host rerenders", () => {
    const { picker, synced } = mountPicker({ "index.html": SAVED });
    act(() => {
      picker().setStyle("color", "red");
      picker().setStyle("background", "blue");
    });
    expect(synced.at(-1)?.["index.html"]).toMatch(/<h1 [^>]*style="color: red; background: blue"/);
  });

  it("builds the next edit on a file the host changed meanwhile", () => {
    const { picker, synced, setHostFiles } = mountPicker({ "index.html": SAVED });
    act(() => picker().setStyle("color", "red"));
    setHostFiles({ "index.html": SAVED.replace(">Title<", ">Renamed<") });
    act(() => picker().setStyle("background", "blue"));
    const written = synced.at(-1)?.["index.html"] ?? "";
    expect(written).toContain(">Renamed</h1>");
    expect(written).not.toContain("color: red");
  });

  it("writes nothing when no saved file holds the element", () => {
    const { picker, synced } = mountPicker({ "index.html": "<div>other</div>" });
    act(() => picker().setStyle("color", "red"));
    expect(synced).toEqual([]);
  });
});
