// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ensureHfIds } from "@hyperframes/parsers/hf-ids";
import { runtimeProtocolMetadata } from "@hyperframes/core/runtime/protocol";
import { afterEach, expect, it, vi } from "vitest";

const writes = vi.hoisted(() => [] as Array<(source: object | null) => void>);
vi.mock("./elementPickerWrites", () => ({
  writePicked: () => new Promise((resolve) => writes.push(resolve)),
}));

import { useElementPicker } from "./useElementPicker";

const SAVED = ensureHfIds(`<!doctype html><html><body>
<div data-composition-id="main" data-start="0" data-duration="10">
<h1 class="clip" data-start="2" data-duration="3" data-track-index="0">Title</h1>
<p class="clip" data-start="0" data-duration="3" data-track-index="1">Note</p>
</div></body></html>`);
const H1_HF_ID = /<h1 [^>]*data-hf-id="([^"]+)"/.exec(SAVED)![1]!;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  writes.length = 0;
  document.body.innerHTML = "";
});

function mountSealedPicker() {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  const synced: Record<string, string>[] = [];
  let api: ReturnType<typeof useElementPicker> | null = null;
  function Harness() {
    api = useElementPicker(
      { current: iframe },
      { workspaceFiles: { "index.html": SAVED }, onSyncFiles: (files) => synced.push(files) },
    );
    return null;
  }
  root = createRoot(document.createElement("div"));
  act(() => root?.render(React.createElement(Harness)));
  const pick = (selector: string, tagName: string) =>
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: iframe.contentWindow,
          origin: window.location.origin,
          data: {
            source: "hf-preview",
            type: "element-picked",
            elementInfo: { selector, tagName },
            ...runtimeProtocolMetadata(30),
          },
        }),
      );
    });
  const answer = (index: number) =>
    act(async () => writes[index]!({ hfId: H1_HF_ID, ownFile: "index.html" }));
  return { picker: () => api!, pick, answer, synced };
}

it("a sealed edit answered after another pick saves to its own element and leaves the new pick alone", async () => {
  const { picker, pick, answer, synced } = mountSealedPicker();
  pick("h1", "h1");
  act(() => picker().setStyle("color", "red"));
  pick("p", "p");
  await answer(0);

  expect(picker().pickedElement?.selector).toBe("p");
  expect(picker().pickedElement?.computedStyles.color).toBeUndefined();
  expect(synced[0]?.["index.html"]).toMatch(/<h1 [^>]*style="color: red"[^>]*>Title<\/h1>/);
});

it("sealed edits answered in turn show on the picked element in the order they were made", async () => {
  const { picker, pick, answer } = mountSealedPicker();
  pick("h1", "h1");
  act(() => picker().setStyle("color", "red"));
  act(() => picker().setDataAttr("mood", "calm"));
  expect(picker().pickedElement?.computedStyles.color).toBeUndefined();
  await answer(0);
  await answer(1);

  expect(picker().pickedElement?.computedStyles.color).toBe("red");
  expect(picker().pickedElement?.dataAttributes.mood).toBe("calm");
});
