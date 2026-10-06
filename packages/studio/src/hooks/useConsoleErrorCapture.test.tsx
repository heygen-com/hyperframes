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

let root: Root | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
});

it("shows the errors a preview raised before its load, once each", async () => {
  const raisedBeforeLoad = "Uncaught Error: GSAP could not load from a or b";
  const previewWindow = new EventTarget() as EventTarget & Record<string, unknown>;
  previewWindow.console = { error: () => undefined };
  const iframe = document.createElement("iframe");
  Object.defineProperty(iframe, "contentWindow", { get: () => previewWindow });

  root = createRoot(document.createElement("div"));
  await act(async () => root?.render(React.createElement(Harness, { iframe })));
  previewWindow[STUDIO_PREVIEW_ERRORS] = [raisedBeforeLoad];
  await act(async () => iframe.dispatchEvent(new Event("load")));

  expect(capture.consoleErrors?.map((finding) => finding.message)).toEqual([raisedBeforeLoad]);
});
