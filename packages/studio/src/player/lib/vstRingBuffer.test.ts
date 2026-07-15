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

describe("VstRingBuffer", () => {
  it("round-trips a sequential push/read at the expected position", () => {
    const ring = new VstRingBuffer(SAMPLE_RATE, SAMPLE_RATE);
    const { left, right } = makeStereo(4, 10);
    ring.push(0, left, right);

    const outLeft = new Float32Array(4);
    const outRight = new Float32Array(4);
    const readCount = ring.read([outLeft, outRight], 4);

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
    const outLeft = new Float32Array(8);
    const outRight = new Float32Array(8);
    const readCount = ring.read([outLeft, outRight], 8);

    expect(readCount).toBe(0);
    expect(Array.from(outLeft)).toEqual(new Array(8).fill(0));
    expect(Array.from(outRight)).toEqual(new Array(8).fill(0));
  });

  it("fills silence for the remainder and reports the real count on a partial underrun", () => {
    const ring = new VstRingBuffer(SAMPLE_RATE, SAMPLE_RATE);
    const { left, right } = makeStereo(3, 5);
    ring.push(0, left, right);

    const outLeft = new Float32Array(6);
    const outRight = new Float32Array(6);
    const readCount = ring.read([outLeft, outRight], 6);

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

  it("does not corrupt buffered data when a gapped push is dropped", () => {
    const ring = new VstRingBuffer(SAMPLE_RATE, SAMPLE_RATE);
    const first = makeStereo(4, 1);
    ring.push(0, first.left, first.right);

    const gapped = makeStereo(4, 999);
    ring.push(5000, gapped.left, gapped.right);

    const outLeft = new Float32Array(4);
    const outRight = new Float32Array(4);
    const readCount = ring.read([outLeft, outRight], 4);

    expect(readCount).toBe(4);
    expect(Array.from(outLeft)).toEqual([1, 2, 3, 4]);
  });

  it("computes driftSamples as transportTimeSec * sampleRate - expectedPos", () => {
    const ring = new VstRingBuffer(SAMPLE_RATE, SAMPLE_RATE);
    const { left, right } = makeStereo(2400, 0);
    ring.push(0, left, right);

    expect(ring.expectedPos).toBe(2400);
    // 0.1s of transport time = 4800 samples; expectedPos is 2400 → drift 2400.
    expect(ring.driftSamples(0.1)).toBeCloseTo(2400, 5);
    // Transport exactly matches expectedPos: zero drift.
    expect(ring.driftSamples(2400 / SAMPLE_RATE)).toBeCloseTo(0, 5);
  });

  it("needsResync compares drift against the threshold (default 50ms)", () => {
    const ring = new VstRingBuffer(SAMPLE_RATE, SAMPLE_RATE);
    // expectedPos stays 0 (nothing pushed yet).
    expect(ring.needsResync(0.03)).toBe(false); // 30ms drift < 50ms default
    expect(ring.needsResync(0.06)).toBe(true); // 60ms drift > 50ms default
    // Custom threshold.
    expect(ring.needsResync(0.06, 0.1)).toBe(false); // 60ms < 100ms threshold
    expect(ring.needsResync(0.11, 0.1)).toBe(true); // 110ms > 100ms threshold
  });

  it("reset clears buffered audio, realigns expectedPos, and clears a pending resync flag", () => {
    const ring = new VstRingBuffer(SAMPLE_RATE, SAMPLE_RATE);
    const first = makeStereo(4, 1);
    ring.push(0, first.left, first.right);
    // Force a resync flag.
    ring.push(5000, first.left, first.right);
    expect(ring.needsResync(0)).toBe(true);

    ring.reset(9600);

    expect(ring.expectedPos).toBe(9600);
    expect(ring.needsResync(9600 / SAMPLE_RATE)).toBe(false);

    // Buffered audio was cleared — a read returns silence, not the old data.
    const outLeft = new Float32Array(4);
    const outRight = new Float32Array(4);
    const readCount = ring.read([outLeft, outRight], 4);
    expect(readCount).toBe(0);
    expect(Array.from(outLeft)).toEqual([0, 0, 0, 0]);
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

      const outLeft = new Float32Array(5);
      const outRight = new Float32Array(5);
      const readCount = ring.read([outLeft, outRight], 5);
      expect(readCount).toBe(5);
      expect(Array.from(outLeft)).toEqual([pos - 5, pos - 4, pos - 3, pos - 2, pos - 1]);
    }
    expect(ring.expectedPos).toBe(pos);
  });
});
