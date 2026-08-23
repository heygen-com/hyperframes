import { describe, expect, it, vi } from "vitest";
import { audioFxWorkletsReady, ensureAudioFxWorklets } from "./audioFxWorklets.js";

/** Just enough of a BaseAudioContext for the registration cache to key on. */
const contextWith = (addModule: (url: string) => Promise<void>): BaseAudioContext =>
  ({ audioWorklet: { addModule } }) as unknown as BaseAudioContext;

describe("ensureAudioFxWorklets", () => {
  it("registers once per context and reuses the result", async () => {
    const addModule = vi.fn(async () => undefined);
    const ctx = contextWith(addModule);

    await ensureAudioFxWorklets(ctx);
    await ensureAudioFxWorklets(ctx);

    expect(addModule).toHaveBeenCalledTimes(1);
    expect(audioFxWorkletsReady(ctx)).toBe(true);
  });

  it("retries after a failure instead of replaying it forever", async () => {
    // The rejected promise used to stay in the cache, so every later attempt
    // got the same rejection back — the limiter, compressor, gate and bitcrush
    // were silent for the life of the context after one transient failure.
    const addModule = vi
      .fn<(url: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("module load failed"))
      .mockResolvedValue(undefined);
    const ctx = contextWith(addModule);

    await expect(ensureAudioFxWorklets(ctx)).rejects.toThrow("module load failed");
    expect(audioFxWorkletsReady(ctx)).toBe(false);

    await expect(ensureAudioFxWorklets(ctx)).resolves.toBeUndefined();
    expect(addModule).toHaveBeenCalledTimes(2);
    expect(audioFxWorkletsReady(ctx)).toBe(true);
  });

  it("refuses a context with no AudioWorklet rather than hanging", async () => {
    const ctx = {} as BaseAudioContext;
    await expect(ensureAudioFxWorklets(ctx)).rejects.toThrow(/secure context/);
  });
});

/**
 * A processor lives until its `process()` returns false — disconnecting the
 * node does not retire it. These all returned true unconditionally, so every
 * chain rebuild that dropped a worklet effect left it running on the audio
 * thread for the rest of the session.
 *
 * The source is taken from the data: URL registration actually hands to
 * `addModule`, so this also proves the URL carries what it claims to.
 */
describe("the worklet processors themselves", () => {
  /** Evaluate the registered module and hand back the processor classes by name. */
  async function loadProcessors(): Promise<Map<string, new (o: unknown) => Processor>> {
    let moduleSource = "";
    await ensureAudioFxWorklets(
      contextWith(async (url: string) => {
        moduleSource = atob(url.replace("data:text/javascript;base64,", ""));
      }),
    );
    const made = new Map<string, new (o: unknown) => Processor>();
    class Base {
      port = {
        onmessage: null as ((e: { data: unknown }) => void) | null,
        postMessage: (data: unknown) => this.port.onmessage?.({ data }),
      };
    }
    new Function("AudioWorkletProcessor", "registerProcessor", "sampleRate", moduleSource)(
      Base,
      (name: string, cls: new (o: unknown) => Processor) => made.set(name, cls),
      48000,
    );
    return made;
  }

  interface Processor {
    port: { postMessage(data: unknown): void };
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
  }

  const block = (): Float32Array[][] => [[new Float32Array(128)]];

  it("every processor keeps running until it is told to stop, then retires", async () => {
    const processors = await loadProcessors();
    expect([...processors.keys()]).toEqual([
      "hf-compressor",
      "hf-limiter",
      "hf-gate",
      "hf-bitcrush",
      "hf-pitchshift",
    ]);

    for (const [name, Cls] of processors) {
      const p = new Cls({ processorOptions: {} });
      expect(p.process(block(), block()), `${name} retired before it was disposed`).toBe(true);
      p.port.postMessage({ __hfDispose: true });
      expect(p.process(block(), block()), `${name} kept running after dispose`).toBe(false);
      // And it stays retired — a later parameter update must not revive it.
      p.port.postMessage({ mix: 0.5 });
      expect(p.process(block(), block()), `${name} came back to life`).toBe(false);
    }
  });

  describe("HfPitchshift", () => {
    const SR = 48000;
    const BLOCK = 128;

    /** Run a mono processor over a whole signal, 128 samples at a time. */
    function run(p: Processor, signal: Float32Array): Float32Array {
      const out = new Float32Array(signal.length);
      for (let at = 0; at < signal.length; at += BLOCK) {
        const inBlock = new Float32Array(BLOCK);
        inBlock.set(signal.subarray(at, at + BLOCK));
        const outBlock = new Float32Array(BLOCK);
        p.process([[inBlock]], [[outBlock]]);
        out.set(outBlock.subarray(0, Math.min(BLOCK, signal.length - at)), at);
      }
      return out;
    }

    function sine(freq: number, seconds: number): Float32Array {
      const n = Math.round(SR * seconds);
      const s = new Float32Array(n);
      for (let i = 0; i < n; i++) s[i] = Math.sin((2 * Math.PI * freq * i) / SR);
      return s;
    }

    /** Rising zero-crossings per second — coarse but enough to catch an octave. */
    function estimateFreq(s: Float32Array, from: number): number {
      const start = Math.round(from * SR);
      let crossings = 0;
      for (let i = start + 1; i < s.length; i++) {
        if ((s[i - 1] ?? 0) < 0 && (s[i] ?? 0) >= 0) crossings++;
      }
      return crossings / ((s.length - start) / SR);
    }

    // This assertion used to be that the output equalled the input DELAYED by
    // grain/2 — the measurement was right and was written down as the contract.
    // But the grain delay is there to shift pitch, and at semitones: 0 nothing
    // is being shifted: the node degenerated into a pure 50 ms delay of the
    // signal, plus a head of silence while the ring filled, under a label that
    // reads "Unchanged pitch".
    it("at semitones: 0, mix: 1 passes the input through untouched", async () => {
      const HfPitchshift = (await loadProcessors()).get("hf-pitchshift");
      if (!HfPitchshift) throw new Error("hf-pitchshift not registered");
      const p = new HfPitchshift({ processorOptions: { semitones: 0, mix: 1 } });
      const input = sine(440, 0.5);
      const output = run(p, input);
      let maxErr = 0;
      for (let i = 0; i < input.length; i++) {
        maxErr = Math.max(maxErr, Math.abs((output[i] ?? 0) - (input[i] ?? 0)));
      }
      expect(maxErr).toBeLessThan(1e-6);
    });

    it("mix: 0 passes the input through untouched too", async () => {
      const HfPitchshift = (await loadProcessors()).get("hf-pitchshift");
      if (!HfPitchshift) throw new Error("hf-pitchshift not registered");
      const p = new HfPitchshift({ processorOptions: { semitones: 7, mix: 0 } });
      const input = sine(440, 0.25);
      const output = run(p, input);
      let maxErr = 0;
      for (let i = 0; i < input.length; i++) {
        maxErr = Math.max(maxErr, Math.abs((output[i] ?? 0) - (input[i] ?? 0)));
      }
      expect(maxErr).toBeLessThan(1e-6);
    });

    /** Largest sample-to-sample step — a splice between the dry and the
     *  ~50 ms-delayed wet path shows up here as a discontinuity. */
    function maxStep(s: Float32Array, from: number, to: number): number {
      let worst = 0;
      for (let i = from + 1; i < to; i++) {
        worst = Math.max(worst, Math.abs((s[i] ?? 0) - (s[i - 1] ?? 0)));
      }
      return worst;
    }

    // Dragging the semitones slider off zero mid-playback swaps the output from
    // x[t] to x[t-50ms]. Switched hard that is an audible click; the wet amount
    // is ramped instead. A 440 Hz sine steps ~0.057 per sample at its steepest,
    // so anything near the signal's own peak is a splice, not the waveform.
    it("does not click when the shift moves off zero mid-signal", async () => {
      const HfPitchshift = (await loadProcessors()).get("hf-pitchshift");
      if (!HfPitchshift) throw new Error("hf-pitchshift not registered");
      const p = new HfPitchshift({ processorOptions: { semitones: 0, mix: 1 } });
      run(p, sine(440, 0.3)); // settled dry, ring warm
      p.p = { ...p.p, semitones: 7 };
      const output = run(p, sine(440, 0.3));
      expect(maxStep(output, 0, output.length)).toBeLessThan(0.2);
    });

    it("does not click on the way back to zero either", async () => {
      const HfPitchshift = (await loadProcessors()).get("hf-pitchshift");
      if (!HfPitchshift) throw new Error("hf-pitchshift not registered");
      const p = new HfPitchshift({ processorOptions: { semitones: 7, mix: 1 } });
      run(p, sine(440, 0.3));
      p.p = { ...p.p, semitones: 0 };
      const output = run(p, sine(440, 0.3));
      expect(maxStep(output, 0, output.length)).toBeLessThan(0.2);
    });

    // ...and having ramped back down it must reach TRUE bypass, not sit on a
    // permanently latched wet path. The render builds a fresh node from the
    // saved attribute and bypasses at semitones 0; a preview that stayed wet
    // would carry a 50 ms delay the export does not have.
    it("returns to true bypass after being shifted and set back to zero", async () => {
      const HfPitchshift = (await loadProcessors()).get("hf-pitchshift");
      if (!HfPitchshift) throw new Error("hf-pitchshift not registered");
      const p = new HfPitchshift({ processorOptions: { semitones: 7, mix: 1 } });
      run(p, sine(440, 0.3));
      p.p = { ...p.p, semitones: 0 };
      run(p, sine(440, 0.3)); // ramp down settles here

      const input = sine(440, 0.3);
      const output = run(p, input);
      let maxErr = 0;
      for (let i = 0; i < input.length; i++) {
        maxErr = Math.max(maxErr, Math.abs((output[i] ?? 0) - (input[i] ?? 0)));
      }
      expect(maxErr).toBeLessThan(1e-6);
    });

    // A node parked at mix 0 has shifted nothing, so it must not have spent
    // anything that stops the zero-shift bypass engaging later.
    it("is transparent at zero after sitting mixed fully out", async () => {
      const HfPitchshift = (await loadProcessors()).get("hf-pitchshift");
      if (!HfPitchshift) throw new Error("hf-pitchshift not registered");
      const p = new HfPitchshift({ processorOptions: { semitones: 7, mix: 0 } });
      run(p, sine(440, 0.3));

      p.p = { ...p.p, semitones: 0, mix: 1 };
      const input = sine(440, 0.3);
      const output = run(p, input);
      let maxErr = 0;
      for (let i = 0; i < input.length; i++) {
        maxErr = Math.max(maxErr, Math.abs((output[i] ?? 0) - (input[i] ?? 0)));
      }
      expect(maxErr).toBeLessThan(1e-6);
    });

    // The ring starts empty, so the taps read zeros for the first grain. That
    // used to come out of the head of every clip as silence; it ramps the wet
    // path in instead, which is unshifted audio rather than no audio.
    it("does not open with silence while the grain buffer fills", async () => {
      const HfPitchshift = (await loadProcessors()).get("hf-pitchshift");
      if (!HfPitchshift) throw new Error("hf-pitchshift not registered");
      const p = new HfPitchshift({ processorOptions: { semitones: 7, mix: 1 } });
      const input = sine(440, 0.5);
      const output = run(p, input);
      // Peak over the first 20 ms — well inside the old dead zone.
      let peak = 0;
      for (let i = 0; i < Math.round(SR * 0.02); i++)
        peak = Math.max(peak, Math.abs(output[i] ?? 0));
      expect(peak).toBeGreaterThan(0.5);
    });

    it("at semitones: 12, doubles the fundamental (one octave up)", async () => {
      const HfPitchshift = (await loadProcessors()).get("hf-pitchshift");
      if (!HfPitchshift) throw new Error("hf-pitchshift not registered");
      const p = new HfPitchshift({ processorOptions: { semitones: 12, mix: 1 } });
      const input = sine(220, 0.5);
      const output = run(p, input);
      // Skip the first couple of grains so the ring buffer is warm.
      const freq = estimateFreq(output, 0.05);
      expect(freq).toBeGreaterThan(220 * 1.7);
      expect(freq).toBeLessThan(220 * 2.3);
    });

    it("at semitones: -12, halves the fundamental (one octave down)", async () => {
      const HfPitchshift = (await loadProcessors()).get("hf-pitchshift");
      if (!HfPitchshift) throw new Error("hf-pitchshift not registered");
      const p = new HfPitchshift({ processorOptions: { semitones: -12, mix: 1 } });
      const input = sine(440, 0.5);
      const output = run(p, input);
      const freq = estimateFreq(output, 0.05);
      expect(freq).toBeGreaterThan(440 * 0.35);
      expect(freq).toBeLessThan(440 * 0.65);
    });
  });
});
