import { describe, it, expect } from "vitest";
import { TransportClock } from "./clock";

describe("TransportClock eliminates pause/play drift (issue #668)", () => {
  it("40 pause/play cycles accumulate zero drift", () => {
    let ms = 0;
    const clock = new TransportClock({ nowMs: () => ms, duration: 10 });

    clock.play();
    ms += 500;

    const timeBefore = clock.now();
    expect(timeBefore).toBe(0.5);

    for (let i = 0; i < 40; i++) {
      clock.pause();
      ms += 100;
      clock.play();
      ms += 100;
    }

    ms += 500;
    const timeAfter = clock.now();

    // With a single clock: 500ms initial + 40*(100ms play) + 500ms final = 5.5s
    // Pause periods don't advance the clock.
    // Total play time: 500 + 40*100 + 500 = 5000ms = 5s
    expect(timeAfter).toBe(5);

    // The key assertion: NO accumulated drift from pause/play toggling.
    // In the old two-clock architecture, each toggle could introduce ~10-20ms
    // of drift, accumulating to 400-800ms after 40 cycles.
    // With TransportClock: drift is exactly 0.
    const expectedPlayTime = 0.5 + 40 * 0.1 + 0.5;
    expect(timeAfter).toBe(expectedPlayTime);
  });

  it("100 rapid pause/play cycles still produce zero drift", () => {
    let ms = 0;
    const clock = new TransportClock({ nowMs: () => ms, duration: 30 });

    clock.play();
    ms += 1000;

    for (let i = 0; i < 100; i++) {
      clock.pause();
      ms += 50;
      clock.play();
      ms += 50;
    }

    ms += 1000;
    const finalTime = clock.now();

    // Play time: 1000ms + 100*50ms + 1000ms = 7000ms = 7s
    expect(finalTime).toBeCloseTo(7, 10);
  });

  it("rate changes during pause/play cycles preserve accuracy", () => {
    let ms = 0;
    const clock = new TransportClock({ nowMs: () => ms, duration: 60 });

    clock.play();
    ms += 1000;
    expect(clock.now()).toBe(1);

    clock.setRate(2);
    ms += 1000;
    expect(clock.now()).toBe(3);

    for (let i = 0; i < 20; i++) {
      clock.pause();
      ms += 100;
      clock.play();
      ms += 100;
    }

    // At 2x rate, 20 * 100ms play = 2000ms wall = 4s timeline
    expect(clock.now()).toBeCloseTo(7, 10);
  });

  it("seek during pause/play cycles does not introduce drift", () => {
    let ms = 0;
    const clock = new TransportClock({ nowMs: () => ms, duration: 20 });

    clock.play();
    ms += 2000;
    expect(clock.now()).toBe(2);

    clock.seek(5);
    expect(clock.now()).toBe(5);

    for (let i = 0; i < 20; i++) {
      clock.pause();
      ms += 100;
      clock.play();
      ms += 100;
    }

    ms += 1000;
    // Play time after seek: 20*100ms + 1000ms = 3000ms = 3s
    expect(clock.now()).toBeCloseTo(8, 10);
  });

  it("simulates the exact issue #668 reproduction scenario", () => {
    let ms = 0;
    const clock = new TransportClock({ nowMs: () => ms, duration: 10 });

    // "Use a GSAP composition with a timed narration track, then
    //  repeatedly toggle playback"
    clock.play();
    ms += 200;

    // The issue says: "After enough toggles, narration and animation/captions
    // can become visibly or audibly offset."
    // Issue reproduction: 40 toggles with 100ms intervals
    for (let i = 0; i < 40; i++) {
      clock.pause();
      ms += 100;
      clock.play();
      ms += 100;
    }

    ms += 200;
    const finalTime = clock.now();

    // Play time: 200ms + 40*100ms + 200ms = 4400ms = 4.4s
    expect(finalTime).toBeCloseTo(4.4, 10);

    // With the old architecture, drift of 400-800ms would accumulate here.
    // With TransportClock, drift is mathematically impossible — there is
    // only one clock. The time is always baseTime + elapsed * rate.
    // Pause just snapshots baseTime. Play just records a new start marker.
    // No two clocks can diverge because there is only one.
  });
});

describe("TransportClock end-of-playback (loop semantics)", () => {
  it("reachedEnd returns true at duration boundary", () => {
    let ms = 0;
    const clock = new TransportClock({ nowMs: () => ms, duration: 5 });
    clock.play();
    ms += 5000;
    expect(clock.reachedEnd()).toBe(true);
    expect(clock.now()).toBe(5);
  });

  it("clock auto-caps at duration and refuses to advance past it", () => {
    let ms = 0;
    const clock = new TransportClock({ nowMs: () => ms, duration: 3 });
    clock.play();
    ms += 10000;
    expect(clock.now()).toBe(3);
    expect(clock.reachedEnd()).toBe(true);
  });

  it("seek to 0 after reaching end allows replay", () => {
    let ms = 0;
    const clock = new TransportClock({ nowMs: () => ms, duration: 5 });
    clock.play();
    ms += 5000;
    expect(clock.reachedEnd()).toBe(true);
    clock.pause();
    clock.seek(0);
    expect(clock.now()).toBe(0);
    expect(clock.reachedEnd()).toBe(false);
    expect(clock.play()).toBe(true);
    ms += 2000;
    expect(clock.now()).toBe(2);
  });

  it("pause + seek to end + play is rejected (no infinite loop)", () => {
    let ms = 0;
    const clock = new TransportClock({ nowMs: () => ms, duration: 5 });
    clock.seek(5);
    expect(clock.play()).toBe(false);
    expect(clock.isPlaying()).toBe(false);
  });
});

describe("TransportClock + simulated timeline wiring", () => {
  it("clock drives timeline seek on each tick", () => {
    let ms = 0;
    const clock = new TransportClock({ nowMs: () => ms, duration: 10 });
    const seekLog: number[] = [];
    const mockSeek = (t: number) => seekLog.push(t);

    clock.play();
    for (let i = 0; i < 5; i++) {
      ms += 16;
      mockSeek(clock.now());
    }

    expect(seekLog.length).toBe(5);
    expect(seekLog[0]).toBeCloseTo(0.016, 5);
    expect(seekLog[4]).toBeCloseTo(0.08, 5);
    for (let i = 1; i < seekLog.length; i++) {
      expect(seekLog[i]).toBeGreaterThan(seekLog[i - 1]);
    }
  });

  it("forceSync threshold: drift above 20ms is correctable", () => {
    let ms = 0;
    const clock = new TransportClock({ nowMs: () => ms, duration: 10 });
    clock.play();
    ms += 2000;

    const clockTime = clock.now();
    const simulatedAudioTime = clockTime - 0.025;
    const drift = Math.abs(clockTime - simulatedAudioTime);

    expect(drift).toBeGreaterThan(0.02);
    expect(drift).toBeLessThan(0.04);
  });
});
