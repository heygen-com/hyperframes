// @vitest-environment happy-dom

import { expect, it, onTestFinished } from "vitest";
import { usePlayerStore } from "../store/playerStore";
import { usePreviewIframeStore } from "../store/previewIframeStore";
import { watchStoreFrameFacts } from "../store/frameFactsFromStores";
import { frameRequestSent, onFrameFactsChanged, type FrameFactChange } from "./frameFacts";

function heard() {
  const changes: FrameFactChange[] = [];
  onTestFinished(onFrameFactsChanged((change) => changes.push(change)));
  return changes;
}

it("hears a draft or any other write to the frame, and no read of it", () => {
  const changes = heard();
  frameRequestSent("query");
  frameRequestSent("gesture-start");
  frameRequestSent("draft");
  frameRequestSent("edit-element");
  frameRequestSent("soft-reload");
  expect(changes).toEqual(["draft", "write", "write"]);
});

it("hears the playhead move, playback start and a new live frame", () => {
  watchStoreFrameFacts();
  const changes = heard();
  usePlayerStore.setState({ currentTime: 1.25 });
  usePlayerStore.setState({ isPlaying: true });
  usePlayerStore.setState({ isPlaying: false });
  usePreviewIframeStore.getState().setIframe(document.createElement("iframe"));
  expect(changes).toEqual(["time", "time", "time", "load"]);
  usePlayerStore.setState({ currentTime: 0 });
  usePreviewIframeStore.getState().setIframe(null);
});
