import { describe, it, expect } from "vitest";
import { TransportClock } from "./clock";

function createClock(opts?: ConstructorParameters<typeof TransportClock>[0]) {
  let ms = 0;
  const clock = new TransportClock({ nowMs: () => ms, ...opts });
  const advance = (deltaMs: number) => {
    ms += deltaMs;
  };
  return { clock, advance, getMs: () => ms };
}

describe("TransportClock", () => {
  describe("initial state", () => {
    it("starts paused at time 0", () => {
      const { clock } = createClock();
      expect(clock.now()).toBe(0);
      expect(clock.isPlaying()).toBe(false);
    });

    it("respects initialTime", () => {
      const { clock } = createClock({ initialTime: 5 });
      expect(clock.now()).toBe(5);
    });

    it("respects initial rate", () => {
      const { clock, advance } = createClock({ rate: 2 });
      clock.play();
      advance(1000);
      expect(clock.now()).toBe(2);
    });

    it("respects initial duration", () => {
      const { clock } = createClock({ duration: 10 });
      expect(clock.getDuration()).toBe(10);
    });
  });

  describe("play/pause", () => {
    it("advances time while playing", () => {
      const { clock, advance } = createClock();
      clock.play();
      advance(1000);
      expect(clock.now()).toBe(1);
    });

    it("freezes time while paused", () => {
      const { clock, advance } = createClock();
      clock.play();
      advance(500);
      clock.pause();
      const t = clock.now();
      advance(500);
      expect(clock.now()).toBe(t);
    });

    it("play returns true on first call, false if already playing", () => {
      const { clock } = createClock();
      expect(clock.play()).toBe(true);
      expect(clock.play()).toBe(false);
    });

    it("pause returns true on first call, false if already paused", () => {
      const { clock } = createClock();
      expect(clock.pause()).toBe(false);
      clock.play();
      expect(clock.pause()).toBe(true);
      expect(clock.pause()).toBe(false);
    });

    it("resumes from where it paused", () => {
      const { clock, advance } = createClock();
      clock.play();
      advance(1000);
      clock.pause();
      expect(clock.now()).toBe(1);
      clock.play();
      advance(1000);
      expect(clock.now()).toBe(2);
    });

    it("does not play past duration", () => {
      const { clock, advance } = createClock({ duration: 5 });
      clock.play();
      advance(10000);
      expect(clock.now()).toBe(5);
    });

    it("refuses to play when already at end", () => {
      const { clock } = createClock({ duration: 5, initialTime: 5 });
      expect(clock.play()).toBe(false);
      expect(clock.isPlaying()).toBe(false);
    });
  });

  describe("seek", () => {
    it("seeks while paused", () => {
      const { clock } = createClock();
      clock.seek(5);
      expect(clock.now()).toBe(5);
      expect(clock.isPlaying()).toBe(false);
    });

    it("seeks while playing without interrupting playback", () => {
      const { clock, advance } = createClock();
      clock.play();
      advance(1000);
      clock.seek(10);
      expect(clock.isPlaying()).toBe(true);
      expect(clock.now()).toBe(10);
      advance(1000);
      expect(clock.now()).toBe(11);
    });

    it("clamps to 0", () => {
      const { clock } = createClock();
      clock.seek(-5);
      expect(clock.now()).toBe(0);
    });

    it("clamps to duration", () => {
      const { clock } = createClock({ duration: 10 });
      clock.seek(20);
      expect(clock.now()).toBe(10);
    });
  });

  describe("rate", () => {
    it("applies rate multiplier to elapsed time", () => {
      const { clock, advance } = createClock({ rate: 2 });
      clock.play();
      advance(1000);
      expect(clock.now()).toBe(2);
    });

    it("rate change mid-play preserves current position", () => {
      const { clock, advance } = createClock();
      clock.play();
      advance(2000);
      expect(clock.now()).toBe(2);
      clock.setRate(2);
      advance(1000);
      expect(clock.now()).toBe(4);
    });

    it("rate change while paused is applied on next play", () => {
      const { clock, advance } = createClock();
      clock.setRate(3);
      clock.play();
      advance(1000);
      expect(clock.now()).toBe(3);
    });

    it("clamps rate to [0.1, 5]", () => {
      const { clock } = createClock();
      clock.setRate(0.01);
      expect(clock.getRate()).toBe(0.1);
      clock.setRate(100);
      expect(clock.getRate()).toBe(5);
    });

    it("defaults to 1 for invalid rate", () => {
      const { clock } = createClock();
      clock.setRate(NaN);
      expect(clock.getRate()).toBe(1);
      clock.setRate(-1);
      expect(clock.getRate()).toBe(1);
    });
  });

  describe("duration", () => {
    it("auto-pauses at duration boundary", () => {
      const { clock, advance } = createClock({ duration: 5 });
      clock.play();
      advance(5000);
      expect(clock.now()).toBe(5);
      expect(clock.reachedEnd()).toBe(true);
    });

    it("setDuration clamps existing baseTime", () => {
      const { clock } = createClock({ initialTime: 10 });
      clock.setDuration(5);
      expect(clock.now()).toBe(5);
    });

    it("setDuration with 0 or negative becomes Infinity", () => {
      const { clock } = createClock({ duration: 5 });
      clock.setDuration(0);
      expect(clock.getDuration()).toBe(Infinity);
      clock.setDuration(-1);
      expect(clock.getDuration()).toBe(Infinity);
    });

    it("reachedEnd returns false when no duration set", () => {
      const { clock, advance } = createClock();
      clock.play();
      advance(999999000);
      expect(clock.reachedEnd()).toBe(false);
    });
  });

  describe("snapshot", () => {
    it("returns current state", () => {
      const { clock, advance } = createClock({ duration: 10, rate: 1.5 });
      clock.play();
      advance(2000);
      const snap = clock.snapshot();
      expect(snap.time).toBe(3);
      expect(snap.playing).toBe(true);
      expect(snap.rate).toBe(1.5);
      expect(snap.duration).toBe(10);
    });
  });

  describe("edge cases", () => {
    it("time never goes negative", () => {
      const { clock } = createClock({ initialTime: 0 });
      clock.seek(-100);
      expect(clock.now()).toBe(0);
    });

    it("multiple play/pause cycles accumulate correctly", () => {
      const { clock, advance } = createClock();
      for (let i = 0; i < 100; i++) {
        clock.play();
        advance(10);
        clock.pause();
      }
      expect(clock.now()).toBeCloseTo(1, 5);
    });

    it("seek to 0 while playing restarts from beginning", () => {
      const { clock, advance } = createClock();
      clock.play();
      advance(5000);
      clock.seek(0);
      expect(clock.now()).toBe(0);
      advance(1000);
      expect(clock.now()).toBe(1);
    });
  });

  describe("audio-master clock", () => {
    function createMockAudioEl(currentTime: number, paused: boolean) {
      return { currentTime, paused } as HTMLMediaElement;
    }

    it("reads time from audio element when attached and playing", () => {
      const { clock } = createClock({ duration: 10 });
      const audioEl = createMockAudioEl(3.5, false);
      clock.play();
      clock.attachAudioSource({ el: audioEl, compositionStart: 0, mediaStart: 0 });
      expect(clock.now()).toBe(3.5);
      expect(clock.getSource()).toBe("audio");
    });

    it("falls back to monotonic when audio is paused", () => {
      const { clock, advance } = createClock({ duration: 10 });
      const audioEl = createMockAudioEl(3.5, true);
      clock.play();
      clock.attachAudioSource({ el: audioEl, compositionStart: 0, mediaStart: 0 });
      advance(1000);
      expect(clock.now()).toBe(1);
      expect(clock.getSource()).toBe("monotonic");
    });

    it("accounts for compositionStart offset", () => {
      const { clock } = createClock({ duration: 20 });
      const audioEl = createMockAudioEl(2.0, false);
      clock.play();
      clock.attachAudioSource({ el: audioEl, compositionStart: 5, mediaStart: 0 });
      expect(clock.now()).toBe(7);
    });

    it("accounts for mediaStart offset", () => {
      const { clock } = createClock({ duration: 20 });
      const audioEl = createMockAudioEl(5.0, false);
      clock.play();
      clock.attachAudioSource({ el: audioEl, compositionStart: 0, mediaStart: 2 });
      expect(clock.now()).toBe(3);
    });

    it("detaching preserves current time and falls back to monotonic", () => {
      const { clock, advance } = createClock({ duration: 20 });
      const audioEl = createMockAudioEl(5.0, false);
      clock.play();
      clock.attachAudioSource({ el: audioEl, compositionStart: 0, mediaStart: 0 });
      expect(clock.now()).toBe(5);
      clock.detachAudioSource();
      expect(clock.now()).toBeCloseTo(5, 1);
      advance(1000);
      expect(clock.now()).toBeCloseTo(6, 1);
      expect(clock.getSource()).toBe("monotonic");
    });

    it("clamps audio-derived time to duration", () => {
      const { clock } = createClock({ duration: 10 });
      const audioEl = createMockAudioEl(15.0, false);
      clock.play();
      clock.attachAudioSource({ el: audioEl, compositionStart: 0, mediaStart: 0 });
      expect(clock.now()).toBe(10);
    });

    it("hasAudioSource returns correct state", () => {
      const { clock } = createClock();
      expect(clock.hasAudioSource()).toBe(false);
      clock.attachAudioSource({
        el: createMockAudioEl(0, false),
        compositionStart: 0,
        mediaStart: 0,
      });
      expect(clock.hasAudioSource()).toBe(true);
      clock.detachAudioSource();
      expect(clock.hasAudioSource()).toBe(false);
    });

    it("audio stall freezes visual time (desired behavior for narration)", () => {
      const { clock } = createClock({ duration: 20 });
      const audioEl = createMockAudioEl(3.0, false);
      clock.play();
      clock.attachAudioSource({ el: audioEl, compositionStart: 0, mediaStart: 0 });
      expect(clock.now()).toBe(3);
      // Audio buffers — currentTime doesn't advance
      expect(clock.now()).toBe(3);
      expect(clock.now()).toBe(3);
      // Audio resumes
      audioEl.currentTime = 3.5;
      expect(clock.now()).toBe(3.5);
    });
  });
});
