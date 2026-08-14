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

    it("at semitones: 0, mix: 1 reproduces the input, delayed by exactly one grain/2", async () => {
      const HfPitchshift = (await loadProcessors()).get("hf-pitchshift");
      if (!HfPitchshift) throw new Error("hf-pitchshift not registered");
      const p = new HfPitchshift({ processorOptions: { semitones: 0, mix: 1 } });
      const input = sine(440, 0.5);
      const output = run(p, input);
      const grain = Math.round(SR * 0.1);
      // readTap reads from `write - 1`, i.e. one sample behind the one just
      // written in this same iteration — so the effective delay is one sample
      // more than the nominal grain/2.
      const delay = grain / 2 + 1;
      // Skip the first grain while the ring buffer is still filling.
      let maxErr = 0;
      for (let i = grain * 2; i < input.length; i++) {
        maxErr = Math.max(maxErr, Math.abs((output[i] ?? 0) - (input[i - delay] ?? 0)));
      }
      expect(maxErr).toBeLessThan(1e-6);
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
