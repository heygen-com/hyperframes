// @vitest-environment happy-dom

import { afterEach, expect, it } from "vitest";
import { MAX_QUERY_MATCHES } from "@hyperframes/core/runtime/editing-port";
import {
  detachedFakeIframe,
  serveEditingRequests,
} from "../../player/hooks/timelinePlayerTestHarness";
import { readFrameWordBoxes } from "./CaptionOverlayUtils";

const closers: Array<() => void> = [];
afterEach(() => closers.splice(0).forEach((close) => close()));

function opaqueFrame(boxes: () => unknown[]) {
  const frame: Record<string, unknown> = { postMessage: () => {} };
  const iframe = detachedFakeIframe(frame);
  Object.defineProperty(iframe, "contentDocument", { value: null });
  Object.defineProperty(frame, "document", {
    get: () => {
      throw new DOMException("blocked", "SecurityError");
    },
  });
  closers.push(serveEditingRequests(frame, () => ({ boxes: boxes() })));
  return iframe;
}

const model = { groupOrder: ["g"], groups: new Map([["g", { segmentIds: ["s0"] }]]) };
const box = { group: 0, word: 0, rect: { x: 0, y: 0, width: 1, height: 1 } };
const read = (iframe: HTMLIFrameElement) =>
  readFrameWordBoxes(iframe, model, document.createElement("div"));

it("reads a frame's word boxes up to the frame's own cap", async () => {
  const iframe = opaqueFrame(() => Array(MAX_QUERY_MATCHES).fill(box));
  expect(await read(iframe)).toHaveLength(MAX_QUERY_MATCHES);
});

it("refuses word boxes past the frame's cap or with a gap", async () => {
  let list: unknown[] = Array(MAX_QUERY_MATCHES + 1).fill(box);
  const iframe = opaqueFrame(() => list);
  expect(await read(iframe)).toBeNull();
  list = [box, box, box];
  delete list[1];
  expect(await read(iframe)).toBeNull();
});

it("refuses at once word boxes whose length has no entries", async () => {
  const iframe = opaqueFrame(() => new Array(2 ** 32 - 1));
  const started = performance.now();
  expect(await read(iframe)).toBeNull();
  expect(performance.now() - started).toBeLessThan(1000);
});
