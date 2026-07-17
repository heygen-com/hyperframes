import { describe, expect, it } from "vitest";
import { VstRingBuffer } from "./vstRingBuffer";

const SAMPLE_RATE = 48000;

function makeStereo(n: number, seed = 1): { left: Float32Array; right: Float32Array } {
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    left[i] = seed + i;
    right[i] = -(seed + i);
  }
  return { left, right };
}

/** Reads `n` samples from `ring` into fresh output buffers — the shared
 *  read-and-assert shape every test below needs. */
function readN(
  ring: VstRingBuffer,
  n: number,
): { left: Float32Array; right: Float32Array; readCount: number } {
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const readCount = ring.read([left, right], n);
  return { left, right, readCount };
}

describe("VstRingBuffer", () => {
  it("round-trips a sequential push/read at the expected position", () => {
    const ring = new VstRingBuffer(SAMPLE_RATE, SAMPLE_RATE);
    const { left, right } = makeStereo(4, 10);
    ring.push(0, left, right);

    const { left: outLeft, right: outRight, readCount } = readN(ring, 4);

    expect(readCount).toBe(4);
    expect(Array.from(outLeft)).toEqual([10, 11, 12, 13]);
    expect(Array.from(outRight)).toEqual([-10, -11, -12, -13]);
    expect(ring.expectedPos).toBe(4);
  });

  it("advances expectedPos across multiple contiguous pushes", () => {
    const ring = new VstRingBuffer(SAMPLE_RATE, SAMPLE_RATE);
    const first = makeStereo(1024, 0);
    ring.push(0, first.left, first.right);
    expect(ring.expectedPos).toBe(1024);

    const second = makeStereo(1024, 1024);
    ring.push(1024, second.left, second.right);
    expect(ring.expectedPos).toBe(2048);
  });

  it("fills silence and reports the real count on a full underrun (nothing buffered)", () => {
    const ring = new VstRingBuffer(SAMPLE_RATE, SAMPLE_RATE);
    const { left: outLeft, right: outRight, readCount } = readN(ring, 8);

    expect(readCount).toBe(0);
    expect(Array.from(outLeft)).toEqual(new Array(8).fill(0));
    expect(Array.from(outRight)).toEqual(new Array(8).fill(0));
  });

  it("fills silence for the remainder and reports the real count on a partial underrun", () => {
    const ring = new VstRingBuffer(SAMPLE_RATE, SAMPLE_RATE);
    const { left, right } = makeStereo(3, 5);
    ring.push(0, left, right);

    const { left: outLeft, right: outRight, readCount } = readN(ring, 6);

    expect(readCount).toBe(3);
    expect(Array.from(outLeft)).toEqual([5, 6, 7, 0, 0, 0]);
    expect(Array.from(outRight)).toEqual([-5, -6, -7, 0, 0, 0]);
  });

  it("drops a block and flags a resync when samplePos gaps from expected", () => {
    const ring = new VstRingBuffer(SAMPLE_RATE, SAMPLE_RATE);
    const first = makeStereo(1024, 0);
    ring.push(0, first.left, first.right);

    // Gap: server skipped ahead to 5000 instead of the expected 1024.
    const second = makeStereo(4, 900);
    ring.push(5000, second.left, second.right);

    // expectedPos is unchanged — the gapped block was dropped, not written.
    expect(ring.expectedPos).toBe(1024);
    expect(ring.needsResync(0)).toBe(true);
  });

  it("clears the resync flag when the stream re-aligns after stale in-flight frames", () => {
    // Live-repro'd loop: every reseek inevitably rejects the frames already
    // on the wire from the OLD stream position; with the flag latched until
    // the next reset, each drift check reseeked again, whose own trailing
    // stale frames latched it again — a permanent reseek loop at the check
    // cadence (stutter burst, then effective silence). An aligned push is
    // proof the stream re-synced, so it must clear the flag.
    const ring = new VstRingBuffer(SAMPLE_RATE, SAMPLE_RATE);
    ring.reset(48000, 1.0); // reseek to 1.0s

    // Stale in-flight frame from before the reseek → dropped + flagged.
    const stale = makeStereo(1024, 7);
    ring.push(20000, stale.left, stale.right);
    expect(ring.needsResync(1.0)).toBe(true);

    // The post-reseek stream arrives at the expected position — re-synced.
    const aligned = makeStereo(1024, 1);
    ring.push(48000, aligned.left, aligned.right);
    expect(ring.needsResync(1.0)).toBe(false);
  });

  it("keeps the resync flag standing across a genuine gap until realigned", () => {
    const ring = new VstRingBuffer(SAMPLE_RATE, SAMPLE_RATE);
    const first = makeStereo(1024, 0);
    ring.push(0, first.left, first.right);

    // A real dropped frame: the stream jumps past the expected position and
    // KEEPS going from the wrong place — never realigns.
    const afterGap = makeStereo(1024, 5);
    ring.push(5000, afterGap.left, afterGap.right);
    expect(ring.needsResync(0)).toBe(true);
    ring.push(6024, afterGap.left, afterGap.right);
    expect(ring.needsResync(0)).toBe(true); // still gapped — flag must persist
  });

  it("does not corrupt buffered data when a gapped push is dropped", () => {
    const ring = new VstRingBuffer(SAMPLE_RATE, SAMPLE_RATE);
    const first = makeStereo(4, 1);
    ring.push(0, first.left, first.right);

    const gapped = makeStereo(4, 999);
    ring.push(5000, gapped.left, gapped.right);

    const { left: outLeft, readCount } = readN(ring, 4);

    expect(readCount).toBe(4);
    expect(Array.from(outLeft)).toEqual([1, 2, 3, 4]);
  });

  it("driftSamples returns 0 before any baseline has been set", () => {
    // Real streams always have SOME one-time startup latency (AudioContext
    // resume + a WebSocket round trip + async sidecar dispatch) between the
    // transport clock starting and the first PCM frame arriving. Without an
    // explicit baseline, comparing absolute transportTimeSec against
    // expectedPos would misread that latency as ongoing drift and force a
    // destructive reseek loop — see setDriftBaseline's doc-comment. Instead,
    // drift reads as 0 until a baseline is explicitly anchored.
    const ring = new VstRingBuffer(SAMPLE_RATE, SAMPLE_RATE);
    const { left, right } = makeStereo(2400, 0);
    ring.push(0, left, right);

    // A full second of "elapsed" transport time with no baseline set would
    // read as 48000 samples of drift under naive absolute comparison — here
    // it must read as zero.
    expect(ring.driftSamples(1.0)).toBe(0);
    expect(ring.needsResync(1.0)).toBe(false);
  });

  it("computes driftSamples relative to the setDriftBaseline anchor", () => {
    const ring = new VstRingBuffer(SAMPLE_RATE, SAMPLE_RATE);
    // Anchor at transport time 0.5s (simulating real startup latency before
    // the first frame arrives) — expectedPos is still 0 at this point.
    ring.setDriftBaseline(0.5);

    const { left, right } = makeStereo(2400, 0);
    ring.push(0, left, right);
    expect(ring.expectedPos).toBe(2400);

    // 0.1s ELAPSED SINCE THE BASELINE (i.e. transport time 0.6s) = 4800
    // samples elapsed; the stream has only advanced 2400 → drift 2400.
    expect(ring.driftSamples(0.6)).toBeCloseTo(2400, 5);
    // Transport time exactly 2400 samples past the baseline: zero drift.
    expect(ring.driftSamples(0.5 + 2400 / SAMPLE_RATE)).toBeCloseTo(0, 5);
  });

  it("needsResync compares drift against the threshold (default 50ms), relative to the baseline", () => {
    const ring = new VstRingBuffer(SAMPLE_RATE, SAMPLE_RATE);
    ring.setDriftBaseline(0);
    // expectedPos stays 0 (nothing pushed yet).
    expect(ring.needsResync(0.03)).toBe(false); // 30ms drift < 50ms default
    expect(ring.needsResync(0.06)).toBe(true); // 60ms drift > 50ms default
    // Custom threshold.
    expect(ring.needsResync(0.06, 0.1)).toBe(false); // 60ms < 100ms threshold
    expect(ring.needsResync(0.11, 0.1)).toBe(true); // 110ms > 100ms threshold
  });

  it("does NOT resync when the stream runs ahead of the playhead (healthy lead buffer)", () => {
    // The sidecar streams a lead cushion, so the stream position is normally
    // AHEAD of the transport playhead (negative drift). That is healthy — the
    // ring self-caps any excess — and must not trip a resync. A two-sided
    // abs() check treated this steady lead as drift and fired a destructive
    // reseek every interval; the check is one-sided (only a stream that has
    // fallen BEHIND resyncs).
    const ring = new VstRingBuffer(SAMPLE_RATE, SAMPLE_RATE);
    ring.setDriftBaseline(0);
    // 0.5s of audio already streamed, but the playhead has barely moved (5ms):
    // stream is ~0.5s AHEAD → large negative drift.
    const { left, right } = makeStereo(SAMPLE_RATE / 2, 0);
    ring.push(0, left, right);
    expect(ring.driftSamples(0.005)).toBeLessThan(0);
    expect(ring.needsResync(0.005)).toBe(false);
  });

  it("reset clears buffered audio, realigns expectedPos, and clears a pending resync flag", () => {
    const ring = new VstRingBuffer(SAMPLE_RATE, SAMPLE_RATE);
    const first = makeStereo(4, 1);
    ring.push(0, first.left, first.right);
    // Force a resync flag.
    ring.push(5000, first.left, first.right);
    expect(ring.needsResync(0)).toBe(true);

    ring.reset(9600, 9600 / SAMPLE_RATE);

    expect(ring.expectedPos).toBe(9600);
    expect(ring.needsResync(9600 / SAMPLE_RATE)).toBe(false);

    // Buffered audio was cleared — a read returns silence, not the old data.
    const { left: outLeft, readCount } = readN(ring, 4);
    expect(readCount).toBe(0);
    expect(Array.from(outLeft)).toEqual([0, 0, 0, 0]);
  });

  it("reset re-anchors the drift baseline to the given transportTimeSec", () => {
    const ring = new VstRingBuffer(SAMPLE_RATE, SAMPLE_RATE);
    ring.reset(9600, 0.2);

    // No time has elapsed since the reset's baseline, and expectedPos
    // already matches the seek target — zero drift.
    expect(ring.driftSamples(0.2)).toBeCloseTo(0, 5);

    const { left, right } = makeStereo(4800, 9600);
    ring.push(9600, left, right);
    // 0.1s elapsed since the reset baseline (transport time 0.3s) = 4800
    // samples elapsed, and the stream advanced by exactly 4800 — zero drift.
    expect(ring.driftSamples(0.3)).toBeCloseTo(0, 5);
  });

  it("reset without a transportTimeSec leaves the drift baseline untouched", () => {
    const ring = new VstRingBuffer(SAMPLE_RATE, SAMPLE_RATE);
    // No baseline has ever been set — reset(pos) alone must not implicitly
    // anchor one, or a caller that only wants to realign the buffer (not
    // measure drift yet) would silently start a drift comparison anyway.
    ring.reset(9600);
    expect(ring.driftSamples(1.0)).toBe(0);
  });

  it("wraps around the circular buffer correctly across many small pushes", () => {
    const capacity = 16;
    const ring = new VstRingBuffer(capacity, SAMPLE_RATE);
    let pos = 0;
    // Push/read in blocks of 5 several times over — exercises wraparound
    // since 5 does not evenly divide the 16-sample capacity.
    for (let round = 0; round < 6; round++) {
      const { left, right } = makeStereo(5, pos);
      ring.push(pos, left, right);
      pos += 5;

      const { left: outLeft, readCount } = readN(ring, 5);
      expect(readCount).toBe(5);
      expect(Array.from(outLeft)).toEqual([pos - 5, pos - 4, pos - 3, pos - 2, pos - 1]);
    }
    expect(ring.expectedPos).toBe(pos);
  });
});
