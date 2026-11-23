import { describe, expect, it } from "vitest";
import { holdAnimationAt } from "./_holdAnimationAt";
import { PendingPauseAnimation } from "./pendingPauseAnimation.test-helpers";

const hold = (animation: PendingPauseAnimation, timeMs: number) =>
  holdAnimationAt(animation as unknown as Animation, timeMs, "test.currentTime", "test.pause");

describe("holdAnimationAt", () => {
  it("holds the sought time on the first frame of a running animation", () => {
    const animation = new PendingPauseAnimation();

    hold(animation, 1000);
    animation.nextFrame();

    expect(animation.currentTime).toBe(1000);
    expect(animation.playState).toBe("paused");
  });

  it("writes the time and retries pause when the first pause throws", () => {
    const animation = new PendingPauseAnimation({ unresolvedPause: true });

    hold(animation, 1000);

    expect(animation.currentTime).toBe(1000);
    expect(animation.calls).toEqual(["pause", "currentTime", "pause"]);
  });

  it("calls pause once when the first call succeeds", () => {
    const animation = new PendingPauseAnimation();

    hold(animation, 1000);

    expect(animation.pauseCalls).toBe(1);
    expect(animation.calls).toEqual(["pause", "currentTime"]);
  });
});
