import assert from "node:assert/strict";
import { createGsapAdapter } from "../src/runtime/adapters/gsap";
import { createRuntimePlayer } from "../src/runtime/player";
import type { RuntimeTimelineLike } from "../src/runtime/types";

type Call = {
  method: "pause" | "seek" | "totalTime";
  time?: number;
  suppressEvents?: boolean;
};

function createTimeline(withTotalTime: boolean): { calls: Call[]; timeline: RuntimeTimelineLike } {
  const calls: Call[] = [];
  const timeline: RuntimeTimelineLike = {
    play: () => undefined,
    pause: () => {
      calls.push({ method: "pause" });
    },
    seek: (timeSeconds: number, suppressEvents?: boolean) => {
      calls.push({ method: "seek", time: timeSeconds, suppressEvents });
    },
    time: () => 0,
    duration: () => 12,
    add: () => undefined,
    paused: () => undefined,
    set: () => undefined,
  };
  if (withTotalTime) {
    timeline.totalTime = (timeSeconds: number, suppressEvents?: boolean) => {
      calls.push({ method: "totalTime", time: timeSeconds, suppressEvents });
    };
  }
  return { calls, timeline };
}

function createPlayer(timeline: RuntimeTimelineLike) {
  const deterministicSeekCalls: number[] = [];
  const syncMediaCalls: number[] = [];
  const renderFrameSeekCalls: number[] = [];
  const player = createRuntimePlayer({
    getTimeline: () => timeline,
    setTimeline: () => undefined,
    getIsPlaying: () => false,
    setIsPlaying: () => undefined,
    getPlaybackRate: () => 1,
    setPlaybackRate: () => undefined,
    getCanonicalFps: () => 30,
    onSyncMedia: (timeSeconds) => {
      syncMediaCalls.push(timeSeconds);
    },
    onStatePost: () => undefined,
    onDeterministicSeek: (timeSeconds) => {
      deterministicSeekCalls.push(timeSeconds);
    },
    onDeterministicPause: () => undefined,
    onDeterministicPlay: () => undefined,
    onRenderFrameSeek: (timeSeconds) => {
      renderFrameSeekCalls.push(timeSeconds);
    },
    onShowNativeVideos: () => undefined,
    getSafeDuration: () => 12,
  });
  return { player, deterministicSeekCalls, syncMediaCalls, renderFrameSeekCalls };
}

function testSeekUsesDeterministicGsapPath(): void {
  const { calls, timeline } = createTimeline(true);
  const { player, deterministicSeekCalls, syncMediaCalls, renderFrameSeekCalls } =
    createPlayer(timeline);
  const quantizedTime = 2;

  player.seek(2.017);

  assert.deepEqual(
    calls,
    [{ method: "pause" }, { method: "totalTime", time: quantizedTime, suppressEvents: false }],
    "player.seek() should use quantized totalTime() when available",
  );
  assert.deepEqual(
    deterministicSeekCalls,
    [quantizedTime],
    "player.seek() should notify adapters with the quantized time",
  );
  assert.deepEqual(syncMediaCalls, [quantizedTime], "media sync should use quantized time");
  assert.deepEqual(
    renderFrameSeekCalls,
    [quantizedTime],
    "render frame seek should use quantized time",
  );
}

function testGsapAdapterPreservesTotalTime(): void {
  const { calls, timeline } = createTimeline(true);
  const adapter = createGsapAdapter({ getTimeline: () => timeline });

  adapter.seek({ time: 2.033333333333333 });

  assert.deepEqual(
    calls,
    [{ method: "pause" }, { method: "totalTime", time: 2.033333333333333, suppressEvents: false }],
    "GSAP adapter should not downgrade deterministic seeks back to seek()",
  );
}

function testGsapAdapterFallsBackToSeek(): void {
  const { calls, timeline } = createTimeline(false);
  const adapter = createGsapAdapter({ getTimeline: () => timeline });

  adapter.seek({ time: 1.5 });

  assert.deepEqual(
    calls,
    [{ method: "pause" }, { method: "seek", time: 1.5, suppressEvents: false }],
    "GSAP adapter should keep working with timelines that only expose seek()",
  );
}

testSeekUsesDeterministicGsapPath();
testGsapAdapterPreservesTotalTime();
testGsapAdapterFallsBackToSeek();

console.log(
  JSON.stringify({
    event: "hyperframe_runtime_seek_verified",
    assertions: 3,
  }),
);
