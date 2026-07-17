// fallow-ignore-file code-duplication
/**
 * `vst-stream` AudioWorkletProcessor — plays back the PCM stream forwarded
 * by `useVstPreview` from the VST sidecar's WebSocket.
 *
 * Runs in the browser's separate audio-rendering thread (AudioWorkletGlobalScope):
 * no `window`, no DOM, and no module imports across the worklet boundary — so
 * this file cannot `import` `VstRingBuffer` from `vstRingBuffer.ts`. The class
 * below is a plain-JS copy of that file's logic.
 *
 * Kept in sync with vstRingBuffer.ts — edit both.
 *
 * Messages handled via `port.onmessage`:
 *   { type: "pcm", samplePos, left: Float32Array, right: Float32Array }
 *   { type: "reset", samplePos }
 */

class VstRingBuffer {
  constructor(capacitySamples, sampleRate) {
    this.capacity = Math.max(1, Math.floor(capacitySamples));
    this.sampleRateValue = sampleRate;
    this.left = new Float32Array(this.capacity);
    this.right = new Float32Array(this.capacity);
    this.writeIndex = 0;
    this.readIndex = 0;
    this.available = 0;
    this.nextExpectedPos = 0;
    this.resyncNeeded = false;
    this.baselineTimeSec = null;
    this.baselineSamplePos = 0;
  }

  get expectedPos() {
    return this.nextExpectedPos;
  }

  push(samplePos, left, right) {
    if (samplePos !== this.nextExpectedPos) {
      this.resyncNeeded = true;
      return;
    }
    // An aligned push proves the stream re-synced — clear the flag so the
    // stale in-flight frames trailing every reset don't latch a permanent
    // reseek loop (see vstRingBuffer.ts's push doc-comment, kept in sync).
    this.resyncNeeded = false;
    const n = Math.min(left.length, right.length);
    this._writeSamples(left, right, n);
    this.nextExpectedPos += n;
  }

  _writeSamples(left, right, n) {
    let writeN = n;
    let srcOffset = 0;
    if (writeN > this.capacity) {
      srcOffset = writeN - this.capacity;
      writeN = this.capacity;
    }
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

  read(out, n) {
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

  setDriftBaseline(transportTimeSec) {
    this.baselineTimeSec = transportTimeSec;
    this.baselineSamplePos = this.nextExpectedPos;
  }

  driftSamples(transportTimeSec) {
    if (this.baselineTimeSec === null) return 0;
    const elapsedWallClock = transportTimeSec - this.baselineTimeSec;
    const elapsedStreamSamples = this.nextExpectedPos - this.baselineSamplePos;
    return elapsedWallClock * this.sampleRateValue - elapsedStreamSamples;
  }

  needsResync(transportTimeSec, thresholdSec = 0.05) {
    if (this.resyncNeeded) return true;
    // One-sided: only a stream that has fallen BEHIND the playhead is a fault.
    // Running ahead (the sidecar's lead cushion) is healthy — see the fuller
    // explanation in vstRingBuffer.ts, kept in sync with this file.
    return this.driftSamples(transportTimeSec) > thresholdSec * this.sampleRateValue;
  }

  reset(samplePos, transportTimeSec) {
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

class VstStreamProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const processorOptions = (options && options.processorOptions) || {};
    // Default: 2s of headroom at the worklet's actual sampleRate (global,
    // set by the browser to match the AudioContext this node belongs to).
    const capacitySamples = processorOptions.capacitySamples || sampleRate * 2;
    this._ring = new VstRingBuffer(capacitySamples, sampleRate);
    // Underrun telemetry: `read()` zero-fills whenever the ring is starved, so
    // count those silent samples. Posted (cumulative + audio-clock time) to the
    // main thread ~2x/sec so playback health is a NUMBER, not a listening call:
    // during steady playback underruns/sec MUST be 0 — any nonzero rate is the
    // sidecar failing to keep the ring fed (see server.py `_pump`).
    this._underrunSamples = 0;
    this._renderedSinceReport = 0;
    this.port.onmessage = (event) => {
      const data = event.data;
      if (!data) return;
      if (data.type === "pcm") {
        this._ring.push(data.samplePos, data.left, data.right);
      } else if (data.type === "reset") {
        this._ring.reset(data.samplePos);
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const left = output[0];
    const right = output[1] || output[0];
    if (left) {
      const filled = this._ring.read([left, right], left.length);
      this._underrunSamples += left.length - filled;
      this._renderedSinceReport += left.length;
      if (this._renderedSinceReport >= sampleRate * 0.5) {
        this.port.postMessage({
          type: "underrun",
          totalSamples: this._underrunSamples,
          atTime: currentTime,
        });
        this._renderedSinceReport = 0;
      }
    }
    // Keep the node alive for the lifetime of the AudioContext.
    return true;
  }
}

registerProcessor("vst-stream", VstStreamProcessor);
