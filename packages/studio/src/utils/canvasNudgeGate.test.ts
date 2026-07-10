import { describe, expect, it } from "vitest";
import { acquireCanvasNudgeKeys, canvasNudgeKeysClaimed } from "./canvasNudgeGate";

describe("canvasNudgeGate", () => {
  it("reports claimed while at least one claim is held", () => {
    expect(canvasNudgeKeysClaimed()).toBe(false);
    const releaseA = acquireCanvasNudgeKeys();
    const releaseB = acquireCanvasNudgeKeys();
    expect(canvasNudgeKeysClaimed()).toBe(true);
    releaseA();
    expect(canvasNudgeKeysClaimed()).toBe(true);
    releaseB();
    expect(canvasNudgeKeysClaimed()).toBe(false);
  });

  it("makes release idempotent so an effect re-run cannot underflow", () => {
    const release = acquireCanvasNudgeKeys();
    release();
    release();
    expect(canvasNudgeKeysClaimed()).toBe(false);
    const releaseNext = acquireCanvasNudgeKeys();
    expect(canvasNudgeKeysClaimed()).toBe(true);
    releaseNext();
  });
});
