// @vitest-environment happy-dom

import { afterEach, beforeEach, expect, it, vi } from "vitest";

type Answer = boolean | null | Promise<boolean | null>;
const channel = vi.hoisted(() => ({ answers: [] as Answer[], asked: 0 }));

vi.mock("../lib/previewChannel", () => ({
  previewFrameOpaque: () => true,
  previewAssetsUnloaded: () => {
    channel.asked += 1;
    return Promise.resolve(channel.answers.shift() ?? null);
  },
}));

import { type AssetWaitState, waitForPreviewAssets } from "./previewAssetWait";

function startSealedWait() {
  const states: AssetWaitState[] = [];
  const pollRef: { current: ReturnType<typeof setInterval> | null } = { current: null };
  waitForPreviewAssets(document.createElement("iframe"), {
    refresh: false,
    pollRef,
    isCurrent: () => true,
    setLoading: (state) => states.push(state),
  });
  return { states, pollRef };
}

beforeEach(() => {
  vi.useFakeTimers();
  channel.answers = [];
  channel.asked = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

// fails without the fix: a sealed frame's missing first answer (a port the load replaced) was taken as ready.
it("asks a sealed frame again when its first answer is missing, and is not ready meanwhile", async () => {
  channel.answers = [null, true];
  const { states } = startSealedWait();

  await vi.advanceTimersByTimeAsync(250);

  expect(states).toEqual(["checking", true]);
});

it("counts a sealed frame's first answer inside the 10 s cap", async () => {
  channel.answers = [new Promise<null>(() => {})];
  const { states } = startSealedWait();

  await vi.advanceTimersByTimeAsync(10_200);

  expect(states.at(-1)).toBe(false);
});

it("asks nothing more once the wait is torn down during the first request", async () => {
  let answer: (unloaded: boolean) => void = () => {};
  channel.answers = [new Promise<boolean>((resolve) => (answer = resolve))];
  const { states, pollRef } = startSealedWait();

  clearInterval(pollRef.current ?? undefined);
  pollRef.current = null;
  answer(true);
  await vi.advanceTimersByTimeAsync(1_000);

  expect(channel.asked).toBe(1);
  expect(states).toEqual(["checking"]);
});
