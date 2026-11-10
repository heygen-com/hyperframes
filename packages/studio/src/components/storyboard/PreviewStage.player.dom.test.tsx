// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import {
  makeAdapterWindow,
  makeFakeIframe,
  renderTimelinePlayerHarness,
  resetPlayerStore,
} from "../../player/hooks/timelinePlayerTestHarness";
import { usePlayerStore } from "../../player/store/playerStore";
import type { StoryboardBoard } from "./useStoryboardBoard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../utils/studioTelemetry", () => ({ trackStudioEvent: vi.fn() }));
vi.mock("./StoryboardBoardView", () => ({
  StoryboardBoardView: ({ onShowInPreview }: { onShowInPreview: (s: number | null) => void }) => (
    <button data-testid="back-to-film" onClick={() => onShowInPreview(null)} />
  ),
}));
const board: StoryboardBoard = {
  path: "boards/storyboard.html",
  revision: 0,
  read: { state: "loading" },
  appeared: true,
};
vi.mock("./useStoryboardBoard", () => ({ useStoryboardBoard: () => board }));

const { PreviewStage } = await import("./PreviewStage");

let stage: Root | null = null;
afterEach(() => {
  act(() => stage?.unmount());
  stage = null;
  document.body.innerHTML = "";
  resetPlayerStore();
  usePlayerStore.setState({ playLocked: false });
  vi.restoreAllMocks();
});

const pressJ = () =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", code: "KeyJ" }));
  });

it("J under the board leaves the hidden film where it was, and works again back on Preview", () => {
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((tick) => frames.push(tick));
  const { api, root } = renderTimelinePlayerHarness();
  const { adapter, win } = makeAdapterWindow();
  act(() => {
    api.iframeRef.current = makeFakeIframe(win);
    api.onIframeLoad();
    usePlayerStore.setState({ timelineReady: true });
  });
  adapter.seek(10);
  const host = document.createElement("div");
  document.body.append(host);
  stage = createRoot(host);
  act(() => stage!.render(<PreviewStage projectId="p1">{null}</PreviewStage>));

  pressJ();
  for (const tick of frames.splice(0)) act(() => tick(1000));
  expect(adapter.getTime()).toBe(10);
  expect(frames).toHaveLength(0);

  act(() => document.querySelector<HTMLButtonElement>('[data-testid="back-to-film"]')!.click());
  pressJ();
  expect(frames.length).toBeGreaterThan(0);
  act(() => root.unmount());
});
