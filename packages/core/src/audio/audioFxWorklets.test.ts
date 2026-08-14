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
});
