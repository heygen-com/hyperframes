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
 * left off). A mismatch — a dropped network frame, stream reordering, or a
 * stale in-flight frame trailing a `reset()` — is never silently absorbed
 * into the buffer at the wrong offset: the block is dropped and a resync
 * flag is raised instead, cleared by `reset()` or by the stream re-aligning
 * on its own (an aligned push — see `push`'s doc-comment).
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
  /** Set by `push` on a `samplePos` gap; cleared by `reset` or an aligned push. */
  private resyncNeeded = false;
  /** Wall-clock/sample-position pair captured at the last `setDriftBaseline`
   *  or `reset` call — see `driftSamples`' doc-comment for why this exists. */
  private baselineTimeSec: number | null = null;
  private baselineSamplePos = 0;

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
   * network frame, or a stale in-flight frame from before a `reset()` —
   * the block is dropped (never written at the wrong offset) and a resync
   * is flagged.
   *
   * An ALIGNED push clears the flag again: reaching the expected position
   * proves the stream re-synced on its own. Without this, the flag latched
   * permanently on the stale frames that inevitably trail every reseek
   * (frames already on the wire when `reset()` ran), so the next drift
   * check reseeked again, whose own trailing stale frames latched it
   * again — a self-sustaining reseek loop at the drift-check cadence that
   * zero-filled the ring every cycle (heard as a stutter burst, then
   * effectively silence). Only a mismatch with NO aligned frame following
   * it — a genuine, persistent gap — now leaves the flag standing for the
   * drift check to act on.
   */
  push(samplePos: number, left: Float32Array, right: Float32Array): void {
    if (samplePos !== this.nextExpectedPos) {
      this.resyncNeeded = true;
      return;
    }
    this.resyncNeeded = false;
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
   * Anchors drift measurement to "how far has the stream progressed SINCE
   * THIS MOMENT" rather than absolute position. Without this, `driftSamples`
   * would compare the sidecar's sample-accurate stream position against
   * wall-clock time measured from whenever the transport's own clock started
   * — but there's always some real, one-time startup latency between "play
   * clicked" and "the sidecar's first PCM frame arrives" (AudioContext
   * autoplay-policy resume, a WebSocket round trip, async dispatch on the
   * sidecar). That latency is normal and harmless — every streaming pipeline
   * has SOME buffering delay — but a naive absolute comparison misreads it as
   * ongoing drift, forces a resync, and since the resync's own reset()
   * re-arms the same absolute comparison, the "drift" reappears identically
   * at the next check, forever: a self-inflicted loop where the correction
   * is the actual cause of the corruption it appears to be fixing. Anchoring
   * to a baseline captured once real streaming begins cancels the fixed
   * startup offset out of the comparison, leaving only drift that genuinely
   * accumulates during playback (real clock-rate mismatches) — the only kind
   * this mechanism is meant to catch.
   */
  setDriftBaseline(transportTimeSec: number): void {
    this.baselineTimeSec = transportTimeSec;
    this.baselineSamplePos = this.nextExpectedPos;
  }

  /**
   * How far (in samples) this buffer's write position has drifted from
   * where the transport thinks playback should be, measured relative to the
   * last `setDriftBaseline`/`reset` anchor (see `setDriftBaseline`'s
   * doc-comment). Returns 0 before any baseline has been set.
   */
  driftSamples(transportTimeSec: number): number {
    if (this.baselineTimeSec === null) return 0;
    const elapsedWallClock = transportTimeSec - this.baselineTimeSec;
    const elapsedStreamSamples = this.nextExpectedPos - this.baselineSamplePos;
    return elapsedWallClock * this.sampleRateValue - elapsedStreamSamples;
  }

  /**
   * True when a `push` gap was flagged (unresolved), or the stream has fallen
   * BEHIND the playhead by more than `thresholdSec` (default 50ms).
   *
   * The check is one-sided on purpose. `driftSamples` is positive when the
   * stream lags the playhead (the ring is draining toward starvation — a real
   * fault a resync fixes) and negative when the stream runs AHEAD of it. Ahead
   * is the normal, healthy state: the sidecar deliberately streams a lead
   * cushion (see server.py `_PUMP_LEAD_SEC`) so the ring stays fed through
   * jitter, and the ring self-caps any excess by dropping its oldest samples.
   * A two-sided `abs()` check treated that steady lead as drift and fired a
   * destructive reseek every interval — the correction causing the corruption.
   */
  needsResync(transportTimeSec: number, thresholdSec = 0.05): boolean {
    if (this.resyncNeeded) return true;
    return this.driftSamples(transportTimeSec) > thresholdSec * this.sampleRateValue;
  }

  /** Clears all buffered audio and realigns `expectedPos` to `samplePos`
   *  (post-seek), re-anchoring the drift baseline to that same moment. */
  reset(samplePos: number, transportTimeSec?: number): void {
    this.left.fill(0);
    this.right.fill(0);
    this.writeIndex = 0;
    this.readIndex = 0;
    this.available = 0;
    this.nextExpectedPos = samplePos;
    this.resyncNeeded = false;
    if (transportTimeSec !== undefined) this.setDriftBaseline(transportTimeSec);
  }
}
