// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { STUDIO_PREVIEW_ERRORS } from "@hyperframes/core/studio-preview-mark";
import { useConsoleErrorCapture } from "./useConsoleErrorCapture";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let capture: ReturnType<typeof useConsoleErrorCapture>;
function Harness({ iframe }: { iframe: HTMLIFrameElement }) {
  capture = useConsoleErrorCapture(iframe);
  return null;
}

function previewFrame() {
  const previewWindow = Object.assign(new EventTarget(), { console: { error: () => undefined } });
  const iframe = document.createElement("iframe");
  Object.defineProperty(iframe, "contentWindow", { get: () => previewWindow });
  return { iframe, previewWindow };
}

const shown = () => capture.consoleErrors?.map((finding) => finding.message);

let root: Root | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
});

it("shows the errors a preview raised before its load, once each", async () => {
  const raisedBeforeLoad = "Uncaught Error: GSAP could not load from a or b";
  const { iframe, previewWindow } = previewFrame();

  root = createRoot(document.createElement("div"));
  await act(async () => root?.render(React.createElement(Harness, { iframe })));
  Object.assign(previewWindow, { [STUDIO_PREVIEW_ERRORS]: [raisedBeforeLoad] });
  await act(async () => iframe.dispatchEvent(new Event("load")));

  expect(shown()).toEqual([raisedBeforeLoad]);
});

it("shows a loaded preview's errors once when the capture attaches to it twice", async () => {
  const raised = "Uncaught Error: GSAP could not load from a or b";
  const { iframe, previewWindow } = previewFrame();
  Object.assign(previewWindow, { [STUDIO_PREVIEW_ERRORS]: [raised] });

  root = createRoot(document.createElement("div"));
  const harness = React.createElement(Harness, { iframe });
  await act(async () => root?.render(React.createElement(React.StrictMode, null, harness)));

  expect(shown()).toEqual([raised]);
});
