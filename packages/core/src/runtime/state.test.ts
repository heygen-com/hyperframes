import { describe, it, expect } from "vitest";
import { createRuntimeState } from "./state";

describe("createRuntimeState", () => {
  it("returns a fresh state with correct defaults", () => {
    const state = createRuntimeState();
    expect(state.isPlaying).toBe(false);
    expect(state.currentTime).toBe(0);
    expect(state.canonicalFps).toBe(30);
    expect(state.playbackRate).toBe(1);
    expect(state.bridgeMuted).toBe(false);
    expect(state.capturedTimeline).toBeNull();
    expect(state.rafId).toBeNull();
    expect(state.tornDown).toBe(false);
    expect(state.maxTimelineDurationSeconds).toBe(1800);
    expect(state.parityModeEnabled).toBe(true);
  });

  it("returns independent instances", () => {
    const a = createRuntimeState();
    const b = createRuntimeState();
    a.isPlaying = true;
    a.currentTime = 5;
    expect(b.isPlaying).toBe(false);
    expect(b.currentTime).toBe(0);
  });

  it("bridge state defaults are correct", () => {
    const state = createRuntimeState();
    expect(state.bridgeLastPostedFrame).toBe(-1);
    expect(state.bridgeLastPostedAt).toBe(0);
    expect(state.bridgeLastPostedPlaying).toBe(false);
    expect(state.bridgeLastPostedMuted).toBe(false);
    expect(state.bridgeMaxPostIntervalMs).toBe(80);
  });

  it("cached arrays start empty", () => {
    const state = createRuntimeState();
    expect(state.cachedTimedMediaEls).toEqual([]);
    expect(state.cachedMediaClips).toEqual([]);
    expect(state.cachedVideoClips).toEqual([]);
    expect(state.injectedCompStyles).toEqual([]);
    expect(state.injectedCompScripts).toEqual([]);
    expect(state.deterministicAdapters).toEqual([]);
  });

  it("state is mutable", () => {
    const state = createRuntimeState();
    state.isPlaying = true;
    state.currentTime = 12.5;
    state.canonicalFps = 60;
    state.tornDown = true;
    expect(state.isPlaying).toBe(true);
    expect(state.currentTime).toBe(12.5);
    expect(state.canonicalFps).toBe(60);
    expect(state.tornDown).toBe(true);
  });
});
