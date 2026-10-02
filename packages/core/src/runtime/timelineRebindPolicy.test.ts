import { describe, expect, it } from "vitest";
import {
  PLAY_REBIND_HOLD_SECONDS,
  TIMELINE_REBIND_INTERVAL_FRAMES,
  shouldAttemptPeriodicTimelineBind,
} from "./timelineRebindPolicy";

describe("shouldAttemptPeriodicTimelineBind", () => {
  it("only checks for replacements at the periodic boundary", () => {
    expect(
      shouldAttemptPeriodicTimelineBind({
        tick: TIMELINE_REBIND_INTERVAL_FRAMES - 1,
        isPlaying: false,
        hasCapturedTimeline: true,
        currentTimeSeconds: 0,
      }),
    ).toBe(false);
    expect(
      shouldAttemptPeriodicTimelineBind({
        tick: TIMELINE_REBIND_INTERVAL_FRAMES,
        isPlaying: false,
        hasCapturedTimeline: true,
        currentTimeSeconds: 0,
      }),
    ).toBe(true);
  });

  it("holds a captured timeline during the first playback seconds", () => {
    expect(
      shouldAttemptPeriodicTimelineBind({
        tick: TIMELINE_REBIND_INTERVAL_FRAMES,
        isPlaying: true,
        hasCapturedTimeline: true,
        currentTimeSeconds: PLAY_REBIND_HOLD_SECONDS - 0.001,
        playingPollDue: true,
      }),
    ).toBe(false);
    expect(
      shouldAttemptPeriodicTimelineBind({
        tick: TIMELINE_REBIND_INTERVAL_FRAMES,
        isPlaying: true,
        hasCapturedTimeline: true,
        currentTimeSeconds: PLAY_REBIND_HOLD_SECONDS,
        playingPollDue: true,
      }),
    ).toBe(true);
  });

  it("does not hold when no timeline has bound yet", () => {
    expect(
      shouldAttemptPeriodicTimelineBind({
        tick: TIMELINE_REBIND_INTERVAL_FRAMES,
        isPlaying: true,
        hasCapturedTimeline: false,
        currentTimeSeconds: 0,
        playingPollDue: true,
      }),
    ).toBe(true);
  });

  it("checks on the poll timer, not the frame counter, while playing", () => {
    const playing = {
      tick: TIMELINE_REBIND_INTERVAL_FRAMES,
      isPlaying: true,
      hasCapturedTimeline: true,
      currentTimeSeconds: PLAY_REBIND_HOLD_SECONDS,
    };
    expect(shouldAttemptPeriodicTimelineBind(playing)).toBe(false);
    expect(shouldAttemptPeriodicTimelineBind({ ...playing, tick: 7, playingPollDue: true })).toBe(
      true,
    );
  });
});
