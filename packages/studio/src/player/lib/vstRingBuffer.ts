/**
 * Fixed-capacity circular buffer for streamed stereo PCM samples arriving
 * from the VST sidecar's WebSocket (see `useVstHost`'s module doc for the
 * wire format). Pure logic — no WebAudio/browser API dependency — so it can
 * run on the main thread (for drift bookkeeping in `useVstPreview`) and,
 * duplicated inline, inside the `vst-stream` AudioWorkletProcessor (see the
 * header comment in `vstStreamWorklet.js`, which must be kept in sync with
 * this file by hand — worklet files can't import across the module graph).
 *
 * `push()` writes are expected to arrive in strictly increasing, contiguous
 * `samplePos` order (each block picking up exactly where the previous one
 * left off). A mismatch — a dropped network frame, or stream reordering —
 * is never silently absorbed into the buffer at the wrong offset: the block
 * is dropped and a resync flag is raised instead, cleared only by the next
 * `reset()` (issued after a seek).
 */
export class VstRingBuffer {
  private readonly capacity: number;
  private readonly sampleRateValue: number;
  private left: Float32Array;
  private right: Float32Array;
  /** Circular write cursor — index of the next slot `push` will write to. */
  private writeIndex = 0;
  /** Circular read cursor — index of the next slot `read` will consume. */
  private readIndex = 0;
  /** Count of valid, unread samples currently buffered. */
  private available = 0;
  /** The sample position `push` expects to start its next write at. */
  private nextExpectedPos: number;
  /** Set by `push` on a `samplePos` gap; cleared only by `reset`. */
  private resyncNeeded = false;

  constructor(capacitySamples: number, sampleRate: number) {
    this.capacity = Math.max(1, Math.floor(capacitySamples));
    this.sampleRateValue = sampleRate;
    this.left = new Float32Array(this.capacity);
    this.right = new Float32Array(this.capacity);
    this.nextExpectedPos = 0;
  }

  /** The sample position `push` expects its next call to start at. */
  get expectedPos(): number {
    return this.nextExpectedPos;
  }

  /**
   * Writes `left`/`right` (equal-length, same sample count) at `samplePos`.
   * If `samplePos` doesn't match `expectedPos` — a gap from a dropped
   * network frame — the block is dropped (never written at the wrong
   * offset) and a resync is flagged; `reset()` is the only way to clear it.
   */
  push(samplePos: number, left: Float32Array, right: Float32Array): void {
    if (samplePos !== this.nextExpectedPos) {
      this.resyncNeeded = true;
      return;
    }
    const n = Math.min(left.length, right.length);
    this.writeSamples(left, right, n);
    this.nextExpectedPos += n;
  }

  private writeSamples(left: Float32Array, right: Float32Array, n: number): void {
    let writeN = n;
    let srcOffset = 0;
    // A single block larger than the whole buffer: keep only its tail.
    if (writeN > this.capacity) {
      srcOffset = writeN - this.capacity;
      writeN = this.capacity;
    }
    // Make room by dropping the oldest unread samples if this write would
    // overflow the buffer (a persistent reader stall).
    const overflow = this.available + writeN - this.capacity;
    if (overflow > 0) {
      this.readIndex = (this.readIndex + overflow) % this.capacity;
      this.available -= overflow;
    }
    for (let i = 0; i < writeN; i++) {
      const idx = (this.writeIndex + i) % this.capacity;
      this.left[idx] = left[srcOffset + i];
      this.right[idx] = right[srcOffset + i];
    }
    this.writeIndex = (this.writeIndex + writeN) % this.capacity;
    this.available += writeN;
  }

  /**
   * Fills `out[0]`/`out[1]` with up to `n` samples. On underrun (fewer than
   * `n` samples buffered) the remainder is filled with silence (zeros).
   * Returns the count of real samples actually available and copied.
   */
  read(out: [Float32Array, Float32Array], n: number): number {
    const avail = Math.min(this.available, n);
    for (let i = 0; i < n; i++) {
      if (i < avail) {
        const idx = (this.readIndex + i) % this.capacity;
        out[0][i] = this.left[idx];
        out[1][i] = this.right[idx];
      } else {
        out[0][i] = 0;
        out[1][i] = 0;
      }
    }
    this.readIndex = (this.readIndex + avail) % this.capacity;
    this.available -= avail;
    return avail;
  }

  /**
   * How far (in samples) this buffer's write position has drifted from
   * where the transport thinks playback should be.
   */
  driftSamples(transportTimeSec: number): number {
    return transportTimeSec * this.sampleRateValue - this.nextExpectedPos;
  }

  /**
   * True when a `push` gap was flagged (unresolved), or the drift exceeds
   * `thresholdSec` (default 50ms) worth of samples.
   */
  needsResync(transportTimeSec: number, thresholdSec = 0.05): boolean {
    if (this.resyncNeeded) return true;
    return Math.abs(this.driftSamples(transportTimeSec)) > thresholdSec * this.sampleRateValue;
  }

  /** Clears all buffered audio and realigns `expectedPos` to `samplePos` (post-seek). */
  reset(samplePos: number): void {
    this.left.fill(0);
    this.right.fill(0);
    this.writeIndex = 0;
    this.readIndex = 0;
    this.available = 0;
    this.nextExpectedPos = samplePos;
    this.resyncNeeded = false;
  }
}
