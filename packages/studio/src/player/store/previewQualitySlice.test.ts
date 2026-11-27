// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { usePlayerStore } from "./playerStore";
import { readStudioUiPreferences } from "../../utils/studioUiPreferences";
import { parsePlaybackHealth, parsePreviewCopies, parsePreviewFacts } from "./previewQualitySlice";

describe("preview quality in the player store", () => {
  it("starts at full quality with no copies, and counts retries", () => {
    const state = usePlayerStore.getState();
    expect(state.previewQuality).toBe(1);
    expect(state.previewCopies).toBeNull();

    const before = state.previewCopiesRetry;
    state.retryPreviewCopies();
    expect(usePlayerStore.getState().previewCopiesRetry).toBe(before + 1);
  });

  it("keeps a person's pick over the app's, and does not save the app's", () => {
    usePlayerStore.setState({ previewQuality: 1, previewQualityChosenBy: null });
    usePlayerStore.getState().setPreviewQuality(0.25, { by: "app" });
    expect(usePlayerStore.getState()).toMatchObject({
      previewQuality: 0.25,
      previewQualityChosenBy: "app",
    });
    expect(readStudioUiPreferences().previewQuality).toBeUndefined();

    usePlayerStore.getState().setPreviewQuality(0.5);
    expect(usePlayerStore.getState()).toMatchObject({
      previewQuality: 0.5,
      previewQualityChosenBy: "person",
    });
    expect(readStudioUiPreferences().previewQuality).toBe(0.5);

    usePlayerStore.getState().setPreviewQuality(0.125, { by: "app" });
    expect(usePlayerStore.getState().previewQuality).toBe(0.5);
    usePlayerStore.getState().setPreviewQuality(1);
  });

  it("drops the health reading measured at the old level when the level changes", () => {
    const choppy = {
      droppedShare: 0.5,
      seconds: 3,
      choppy: true,
      fps: 14,
      worstFrameMs: 180,
      mode: "play",
    } as const;
    usePlayerStore.setState({ previewQuality: 1, previewQualityChosenBy: null });
    usePlayerStore.getState().setPlaybackHealth(choppy);
    usePlayerStore.getState().setPreviewQuality(1);
    expect(usePlayerStore.getState().playbackHealth).toEqual(choppy);

    usePlayerStore.getState().setPreviewQuality(0.5);
    expect(usePlayerStore.getState().playbackHealth).toBeNull();

    usePlayerStore.setState({ previewQualityChosenBy: null });
    usePlayerStore.getState().setPlaybackHealth(choppy);
    usePlayerStore.getState().setPreviewQuality(0.25, { by: "app" });
    expect(usePlayerStore.getState().playbackHealth).toBeNull();
    usePlayerStore.getState().setPreviewQuality(1);
  });

  it("reads a report of the copies only when it has the shape of one", () => {
    expect(
      parsePreviewCopies({ total: 2, ready: 1, failed: 1, progress: 0.75, error: "failed" }),
    ).toEqual({ total: 2, ready: 1, failed: 1, progress: 0.75, error: "failed" });
    expect(parsePreviewCopies(null)).toBeNull();
    expect(parsePreviewCopies({ total: "2", ready: 1, failed: 0, progress: 0 })).toBeNull();
    expect(parsePreviewCopies({ total: 2, ready: 1, failed: 0 })).toBeNull();
  });

  it("keeps the clock the runtime names, and only a clock it knows", () => {
    const health = {
      droppedShare: 0.4,
      seconds: 3,
      choppy: true,
      fps: 40,
      worstFrameMs: 90,
      mode: "play",
    };
    expect(parsePlaybackHealth({ ...health, clockSource: "webaudio" })?.clockSource).toBe(
      "webaudio",
    );
    expect(
      parsePlaybackHealth({ ...health, clockSource: "/Users/a/film.mp3" })?.clockSource,
    ).toBeUndefined();
    expect(parsePlaybackHealth(health)?.clockSource).toBeUndefined();
  });

  it("keeps what held play when the runtime names it in its own shape, and drops any other shape", () => {
    const health = {
      droppedShare: 1,
      seconds: 3,
      choppy: true,
      fps: 0,
      worstFrameMs: 20,
      mode: "play",
    };
    const heldBy = { kind: "audio", readyState: 1, networkState: 2, fetchMs: 3500 };
    expect(parsePlaybackHealth({ ...health, heldBy })?.heldBy).toEqual(heldBy);
    expect(
      parsePlaybackHealth({ ...health, heldBy: { ...heldBy, fetchMs: null } })?.heldBy,
    ).toEqual({
      ...heldBy,
      fetchMs: null,
    });
    expect(parsePlaybackHealth({ ...health, heldBy: null })?.heldBy).toBeNull();
    expect(
      parsePlaybackHealth({ ...health, heldBy: { ...heldBy, fetchMs: "3500" } })?.heldBy,
    ).toBeUndefined();
    expect(
      parsePlaybackHealth({ ...health, heldBy: { ...heldBy, kind: "/a/b.mp3" } })?.heldBy,
    ).toBeUndefined();
    expect(parsePlaybackHealth(health)?.heldBy).toBeUndefined();
  });

  // fails without the fix: parsePlaybackHealth and parsePreviewFacts did not validate/keep the new optional fields.
  it("validates, bounds, and allowlists mediaStepP90Ms, over16, over33, and motionBlur in playback health", () => {
    const base = {
      droppedShare: 0.1,
      seconds: 3,
      choppy: false,
      fps: 30,
      worstFrameMs: 20,
      mode: "play",
    };
    const blur = { attr: "medium", shutter: "180", state: "on", tier: "filter", movers: 3 };
    const parsed = parsePlaybackHealth({
      ...base,
      mediaStepP90Ms: 25,
      over16: 4,
      over33: 1,
      motionBlur: blur,
    });
    expect(parsed).toMatchObject({
      mediaStepP90Ms: 25,
      over16: 4,
      over33: 1,
      motionBlur: blur,
    });
    expect(parsePlaybackHealth({ ...base, mediaStepP90Ms: null, motionBlur: null })).toMatchObject({
      mediaStepP90Ms: null,
      motionBlur: null,
    });
    // Negative, NaN, Infinity, oversized strings, and unknown enum values are rejected.
    const bad = parsePlaybackHealth({
      ...base,
      mediaStepP90Ms: -5,
      over16: Number.NaN,
      over33: Number.POSITIVE_INFINITY,
      motionBlur: { attr: "x".repeat(64), shutter: null, state: "on", tier: "filter", movers: 1 },
    });
    expect(bad?.mediaStepP90Ms).toBeUndefined();
    expect(bad?.over16).toBeUndefined();
    expect(bad?.over33).toBeUndefined();
    expect(bad?.motionBlur).toBeUndefined();
    expect(
      parsePlaybackHealth({
        ...base,
        motionBlur: { attr: "on", shutter: null, state: "bogus", tier: "filter", movers: 1 },
      })?.motionBlur,
    ).toBeUndefined();
    expect(
      parsePlaybackHealth({
        ...base,
        motionBlur: { attr: "on", shutter: null, state: "on", tier: "gpu", movers: 1 },
      })?.motionBlur,
    ).toBeUndefined();
    expect(
      parsePlaybackHealth({
        ...base,
        motionBlur: { attr: "on", shutter: null, state: "on", tier: "filter", movers: -1 },
      })?.motionBlur,
    ).toBeUndefined();
  });

  it("validates and bounds frameShape in preview facts", () => {
    const base = {
      sceneCount: 1,
      mountedElementCount: 20,
      durationSeconds: 10,
      videos: [],
      lighterAt: [],
      copiesReady: true,
    };
    expect(
      parsePreviewFacts({
        ...base,
        frameShape: { canvas: 2, svg: 1, filter: 3, tweens: 12 },
      })?.frameShape,
    ).toEqual({ canvas: 2, svg: 1, filter: 3, tweens: 12 });
    expect(
      parsePreviewFacts({
        ...base,
        frameShape: { canvas: 0, svg: 0, filter: 0, tweens: null },
      })?.frameShape,
    ).toEqual({ canvas: 0, svg: 0, filter: 0, tweens: null });
    expect(
      parsePreviewFacts({
        ...base,
        frameShape: { canvas: -1, svg: 0, filter: 0, tweens: 0 },
      })?.frameShape,
    ).toBeUndefined();
    expect(
      parsePreviewFacts({
        ...base,
        frameShape: { canvas: 0, svg: Number.NaN, filter: 0, tweens: 0 },
      })?.frameShape,
    ).toBeUndefined();
    expect(
      parsePreviewFacts({
        ...base,
        frameShape: { canvas: 0, svg: 0, filter: 0, tweens: "3" },
      })?.frameShape,
    ).toBeUndefined();
  });
});
