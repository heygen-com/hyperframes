// @vitest-environment happy-dom
import React, { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { create } from "zustand";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { StoryboardBoard } from "./useStoryboardBoard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pauses = vi.fn();
const player = create<{
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  requestPlayback: (playing: boolean) => void;
  requestSeek: (seconds: number) => void;
}>((set) => ({
  isPlaying: false,
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  requestPlayback: (playing) => {
    if (!playing) pauses();
  },
  requestSeek: () => {},
}));
vi.mock("../../player", () => ({ usePlayerStore: player }));
vi.mock("../../utils/studioTelemetry", () => ({ trackStudioEvent: vi.fn() }));
vi.mock("./StoryboardBoardView", () => ({
  StoryboardBoardView: () => <div data-testid="board-view" />,
}));
let board: StoryboardBoard;
vi.mock("./useStoryboardBoard", () => ({ useStoryboardBoard: () => board }));

const { PreviewStage } = await import("./PreviewStage");

const noBoard: StoryboardBoard = {
  path: null,
  revision: 0,
  read: { state: "loading" },
  appeared: false,
};
const written: StoryboardBoard = { ...noBoard, path: "boards/storyboard.html", appeared: true };

let mounts = 0;
function Film() {
  useEffect(() => {
    mounts += 1;
  }, []);
  return <div data-testid="film" />;
}

let root: Root;
const render = () =>
  act(async () =>
    root.render(
      <PreviewStage projectId="p1">
        <Film />
      </PreviewStage>,
    ),
  );
const boardShown = () => document.querySelector('[data-testid="board-view"]') !== null;

beforeEach(() => {
  mounts = 0;
  board = noBoard;
  player.setState({ isPlaying: false });
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

it("keeps the film mounted and pauses it when the agent's board first appears", async () => {
  player.setState({ isPlaying: true });
  await render();
  board = written;
  await render();
  expect(boardShown()).toBe(true);
  expect(mounts).toBe(1);
  expect(pauses).toHaveBeenCalled();
});

it("keeps the film mounted when the board goes and comes back", async () => {
  board = written;
  await render();
  board = noBoard;
  await render();
  expect(boardShown()).toBe(false);
  board = written;
  await render();
  expect(mounts).toBe(1);
});

it("pauses a play started while the board covers the film, as a shortcut would", async () => {
  await render();
  board = written;
  await render();
  pauses.mockClear();
  await act(async () => player.getState().setIsPlaying(true));
  expect(pauses).toHaveBeenCalledTimes(1);
});
