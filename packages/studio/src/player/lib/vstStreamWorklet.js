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
  }

  get expectedPos() {
    return this.nextExpectedPos;
  }

  push(samplePos, left, right) {
    if (samplePos !== this.nextExpectedPos) {
      this.resyncNeeded = true;
      return;
    }
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

  driftSamples(transportTimeSec) {
    return transportTimeSec * this.sampleRateValue - this.nextExpectedPos;
  }

  needsResync(transportTimeSec, thresholdSec = 0.05) {
    if (this.resyncNeeded) return true;
    return Math.abs(this.driftSamples(transportTimeSec)) > thresholdSec * this.sampleRateValue;
  }

  reset(samplePos) {
    this.left.fill(0);
    this.right.fill(0);
    this.writeIndex = 0;
    this.readIndex = 0;
    this.available = 0;
    this.nextExpectedPos = samplePos;
    this.resyncNeeded = false;
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
      this._ring.read([left, right], left.length);
    }
    // Keep the node alive for the lifetime of the AudioContext.
    return true;
  }
}

registerProcessor("vst-stream", VstStreamProcessor);
