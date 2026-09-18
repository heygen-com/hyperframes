import { describe, it, expect } from "vitest";
import { TransportClock } from "./clock";

// Stall policy for TransportClock's interactive playback — see the PR body.

function createClock(opts?: ConstructorParameters<typeof TransportClock>[0]) {
  let ms = 0;
  const clock = new TransportClock({ nowMs: () => ms, ...opts });
  const advance = (deltaMs: number) => {
    ms += deltaMs;
  };
  return { clock, advance };
}

describe("TransportClock stall policy — interactive playback", () => {
  it("a gap under the 500ms threshold advances exactly, unsmoothed", () => {
    const { clock, advance } = createClock();
    clock.play();
    advance(16); // one ordinary frame at 60fps
    expect(clock.now()).toBeCloseTo(0.016, 10);
    advance(480); // still under threshold
    expect(clock.now()).toBeCloseTo(0.496, 10);
  });

  it("blocking the thread for 4.6s (the measured frost-sequence-camera-orbit stall) advances by at most the adjusted lag, not the whole gap", () => {
    const { clock, advance } = createClock();
    clock.play();
    advance(16);
    const before = clock.now(); // establishes the read baseline the stall is measured against
    advance(4600); // the rAF loop never got a chance to run during this
    const after = clock.now(); // the first read after the stall is what applies the correction
    expect(after - before).toBeCloseTo(0.033, 10);
    expect(after - before).toBeLessThan(4.6);
  });

  it("a stall this severe (8s, the measured WebKit-engine case) is still corrected, not just the smaller 4.6s one", () => {
    const { clock, advance } = createClock();
    clock.play();
    advance(16);
    const before = clock.now();
    advance(8000);
    expect(clock.now() - before).toBeCloseTo(0.033, 10);
  });

  it("playback continues advancing normally after a stall — the correction does not stick the clock", () => {
    const { clock, advance } = createClock();
    clock.play();
    advance(16);
    clock.now(); // read baseline, so the next gap is actually measured as a stall
    advance(4600); // stall
    const afterStall = clock.now();
    advance(16); // one more ordinary frame
    expect(clock.now() - afterStall).toBeCloseTo(0.016, 10);
  });

  it("many reads within the same real frame do not each get treated as a separate stall window", () => {
    const { clock, advance } = createClock();
    clock.play();
    advance(16);
    // Several callers read `now()` within the same real frame (state sync,
    // media sync, audio timing, plus a second driver like the parent-tick
    // bridge) — none of those back-to-back reads should see each other as a
    // gap.
    const a = clock.now();
    const b = clock.now();
    const c = clock.now();
    expect(a).toBe(b);
    expect(b).toBe(c);
    advance(4600); // a real stall before the next frame's reads
    expect(clock.now() - a).toBeCloseTo(0.033, 10);
  });

  it("a second reader (simulating the parent-tick bridge) is protected by the same correction, with no wiring of its own", () => {
    const { clock, advance } = createClock();
    clock.play();
    // Two independent "drivers" reading the same clock, exactly as
    // packages/core/src/runtime/init.ts's transportTick and
    // packages/player/src/hyperframes-player.ts's parent-tick bridge do —
    // neither is a distinguished caller; both just call now().
    const driverA = () => clock.now();
    const driverB = () => clock.now();
    advance(16);
    driverA();
    advance(4600); // stall, discovered by whichever driver reads first
    const readByB = driverB(); // the OTHER driver — not the one that established the baseline
    expect(readByB).toBeCloseTo(0.049, 10); // 0.016 + 0.033, corrected regardless of who asks
  });

  it("a long gap between reads while audio is authoritative does not corrupt the later monotonic fallback", () => {
    const { clock, advance } = createClock({ duration: 30 });
    const audioEl = { currentTime: 2, paused: false } as HTMLMediaElement;
    clock.play();
    clock.attachAudioSource({ el: audioEl, compositionStart: 0, mediaStart: 0 });
    expect(clock.now()).toBe(2); // audio-authoritative, correct
    advance(5000); // audio itself doesn't stall; nothing here reads the monotonic side
    audioEl.currentTime = 5;
    expect(clock.now()).toBe(5); // still audio-authoritative, still correct
    // Audio becomes unavailable without a formal detachAudioSource() call —
    // now() falls through to monotonic within the same read.
    Object.assign(audioEl, { paused: true });
    // The fallback must read as if no stall correction ever ran: this is the
    // first monotonic-branch read, so it must not be held back by the 5s gap
    // that only ever applied to audio-authoritative reads. Real elapsed time
    // since play() is exactly 5s (the one advance() call above); a corrupted
    // `_playStartMs` would report roughly 33ms instead.
    expect(clock.now()).toBeCloseTo(5, 2);
  });

  it("a monotonic read before audio takes over does not go stale across the whole audio-authoritative stretch", () => {
    const { clock, advance } = createClock({ duration: 30 });
    const audioEl = { currentTime: 0, paused: true } as HTMLMediaElement;
    clock.play();
    clock.attachAudioSource({ el: audioEl, compositionStart: 0, mediaStart: 0 });
    expect(clock.now()).toBeCloseTo(0, 5); // audio not ready yet, falls to monotonic
    advance(10); // audio starts an instant later
    Object.assign(audioEl, { paused: false, currentTime: 0.01 });
    expect(clock.now()).toBeCloseTo(0.01, 2); // now audio-authoritative
    advance(10_000); // ten real seconds pass, entirely under audio's own clock
    audioEl.currentTime = 10.01;
    expect(clock.now()).toBe(10.01); // still audio-authoritative, still correct
    Object.assign(audioEl, { paused: true }); // audio drops out, no detachAudioSource()
    // The stale pre-audio read must not be what this gets compared against:
    // ~10.01s of real time genuinely passed and none of it was a stall.
    expect(clock.now()).toBeCloseTo(10.01, 1);
  });

  it("real elapsed time during a sustained audio outage advances normally, not smoothed away as a stall", () => {
    const { clock, advance } = createClock({ duration: 30 });
    const audioEl = { currentTime: 0, paused: true } as HTMLMediaElement;
    clock.play();
    clock.attachAudioSource({ el: audioEl, compositionStart: 0, mediaStart: 0 });
    // Audio stays unavailable (buffering) for two real seconds, polled at a
    // normal frame cadence — no JS-thread stall anywhere in this window.
    let reported = clock.now();
    for (let frame = 0; frame < 120; frame++) {
      advance(16.666);
      reported = clock.now();
    }
    expect(reported).toBeCloseTo(2, 1);
  });

  it("a long real gap while genuinely paused is not a stall — resuming play() does not inherit it", () => {
    const { clock, advance } = createClock();
    clock.play();
    advance(16);
    clock.pause();
    advance(10_000); // ten real seconds paused — a user just left the tab
    clock.play();
    advance(16);
    expect(clock.now()).toBeCloseTo(0.032, 10);
  });

  it("seeking right after a corrected stall does not inherit or re-trigger the correction", () => {
    const { clock, advance } = createClock({ duration: 30 });
    clock.play();
    advance(16);
    clock.now(); // read baseline
    advance(4600); // stall
    expect(clock.now()).toBeCloseTo(0.049, 10); // this read is what applies the correction
    clock.seek(10); // an explicit user scrub — must override cleanly
    expect(clock.now()).toBe(10); // the seek's target, not something the stall's math leaked into
    advance(16); // ordinary next frame after the seek
    expect(clock.now()).toBeCloseTo(10.016, 10);
  });

  it("a rate change right after a corrected stall applies the new rate from the corrected point, not the raw gap", () => {
    const { clock, advance } = createClock();
    clock.play();
    advance(16);
    clock.now(); // read baseline
    advance(4600); // stall; setRate below is what next reads the clock
    clock.setRate(2);
    // setRate reads now() before switching rate, which is where the 4.6s gap
    // gets corrected to the 33ms adjusted lag: 0.016 + 0.033 = 0.049.
    advance(16); // one more frame, now at the new 2x rate
    expect(clock.now()).toBeCloseTo(0.049 + 0.032, 5);
  });
});

describe("TransportClock stall policy — render/export capture is untouched", () => {
  // packages/producer's `renderSeek` (init.ts) always pauses then seeks; never plays.
  it("a seek while paused reports exactly the seeked time, regardless of any elapsed wall time before it", () => {
    const { clock, advance } = createClock({ duration: 30 });
    clock.seek(1 / 30);
    expect(clock.now()).toBe(1 / 30);
    advance(60_000); // an arbitrarily long real gap between two render frames
    clock.seek(2 / 30);
    expect(clock.now()).toBe(2 / 30);
  });

  it("a full frame-by-frame render pass, each frame preceded by a large real-time gap, advances exactly — never smoothed", () => {
    const { clock, advance } = createClock({ duration: 1 });
    const fps = 30;
    for (let frame = 0; frame <= fps; frame++) {
      advance(5000); // rendering one frame is slow in wall-clock terms; irrelevant to the result
      const target = Math.min(frame / fps, 1);
      clock.seek(target);
      expect(clock.now()).toBe(target);
    }
  });

  it("isPlaying() is false throughout a render pass — the stall policy's gate is provably never open", () => {
    const { clock, advance } = createClock({ duration: 1 });
    for (let frame = 0; frame <= 30; frame++) {
      advance(1000);
      clock.seek(frame / 30);
      expect(clock.isPlaying()).toBe(false);
    }
  });
});
