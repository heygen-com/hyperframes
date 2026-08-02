// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { defaultAudioFxParams, HF_AUDIO_FX, type HfAudioFxChain } from "../audioFx.js";
import {
  buildFxChain,
  buildFxNode,
  chainNeedsWorklets,
  synthesizeReverbImpulse,
} from "./audioFxGraph.js";

/**
 * happy-dom has no Web Audio, and a real AudioContext needs a browser. These
 * cover the graph wiring: which nodes get made, how they connect, and when an
 * update can happen in place instead of forcing a rebuild. Whether each graph
 * *sounds* like its FFmpeg counterpart is a separate measurement — that is the
 * parity harness's job, and it runs in a real browser.
 */
class FakeParam {
  constructor(public value = 0) {}
}
class FakeNode {
  connections: FakeNode[] = [];
  disconnected = false;
  frequency = new FakeParam();
  Q = new FakeParam();
  gain = new FakeParam();
  delayTime = new FakeParam();
  type = "";
  curve: Float32Array | null = null;
  oversample = "none";
  buffer: unknown = null;
  normalize = true;
  port = { postMessage: (m: unknown) => this.messages.push(m) };
  messages: unknown[] = [];
  constructor(public kind: string) {}
  connect(next: FakeNode): FakeNode {
    this.connections.push(next);
    return next;
  }
  disconnect(): void {
    this.disconnected = true;
  }
  start(): void {}
  stop(): void {}
}

class FakeCtx {
  sampleRate = 48000;
  created: FakeNode[] = [];
  private make(kind: string): FakeNode {
    const node = new FakeNode(kind);
    this.created.push(node);
    return node;
  }
  createGain() {
    return this.make("gain");
  }
  createBiquadFilter() {
    return this.make("biquad");
  }
  createIIRFilter() {
    return this.make("iir");
  }
  createDelay() {
    return this.make("delay");
  }
  createOscillator() {
    return this.make("osc");
  }
  createWaveShaper() {
    return this.make("waveshaper");
  }
  createConvolver() {
    return this.make("convolver");
  }
  createBuffer(_c: number, length: number) {
    return { length, getChannelData: () => new Float32Array(length) };
  }
}

// AudioWorkletNode is constructed directly, not via a context factory, so the
// instances are recorded here rather than in FakeCtx.created.
const workletNodes: FakeWorkletNode[] = [];
class FakeWorkletNode extends FakeNode {
  constructor(
    _ctx: unknown,
    public name: string,
    public options: { processorOptions: unknown },
  ) {
    super("worklet");
    workletNodes.push(this);
  }
}
(globalThis as unknown as { AudioWorkletNode: unknown }).AudioWorkletNode = FakeWorkletNode;

const ctx = (): FakeCtx => new FakeCtx();
const asCtx = (c: FakeCtx) => c as unknown as BaseAudioContext;
const chain = (...types: string[]): HfAudioFxChain => ({
  version: 1,
  nodes: types.map((t) => ({ type: t, enabled: true, params: defaultAudioFxParams(t) })),
});

describe("buildFxNode", () => {
  it("builds a node for every effect in the registry", () => {
    for (const def of HF_AUDIO_FX) {
      const c = ctx();
      expect(
        () => buildFxNode(asCtx(c), def.id, defaultAudioFxParams(def.id)),
        `${def.id} failed to build`,
      ).not.toThrow();
    }
  });

  it("rejects an unknown effect", () => {
    expect(() => buildFxNode(asCtx(ctx()), "nope", {})).toThrow(/Unknown effect/);
  });

  it("uses a two-pole biquad by default and a one-pole IIR when asked", () => {
    const two = ctx();
    buildFxNode(asCtx(two), "highpass", { ...defaultAudioFxParams("highpass"), poles: "2" });
    expect(two.created.some((n) => n.kind === "biquad")).toBe(true);
    expect(two.created.some((n) => n.kind === "iir")).toBe(false);

    const one = ctx();
    buildFxNode(asCtx(one), "highpass", { ...defaultAudioFxParams("highpass"), poles: "1" });
    expect(one.created.some((n) => n.kind === "iir")).toBe(true);
  });

  it("applies parameters to the biquad rather than leaving defaults", () => {
    const c = ctx();
    buildFxNode(asCtx(c), "peaking", { frequency: 750, gain: -9, q: 3 });
    const bq = c.created.find((n) => n.kind === "biquad")!;
    expect(bq.type).toBe("peaking");
    expect(bq.frequency.value).toBe(750);
    expect(bq.gain.value).toBe(-9);
    expect(bq.Q.value).toBe(3);
  });

  it("clamps an out-of-range value on the way into the graph", () => {
    const c = ctx();
    buildFxNode(asCtx(c), "peaking", { frequency: 10_000_000, gain: 0, q: 1 });
    expect(c.created.find((n) => n.kind === "biquad")!.frequency.value).toBe(20000);
  });

  it("sends worklet parameters through the port on update", () => {
    workletNodes.length = 0;
    const c = ctx();
    const h = buildFxNode(asCtx(c), "compressor", defaultAudioFxParams("compressor"));
    expect(workletNodes).toHaveLength(1);
    expect(workletNodes[0]!.name).toBe("hf-compressor");
    h.update({ ...defaultAudioFxParams("compressor"), threshold: -30 });
    // Turning a dial re-parameterises the running processor instead of
    // rebuilding it, which is what keeps the knob-to-ear loop immediate.
    expect(workletNodes[0]!.messages).toHaveLength(1);
    expect(workletNodes[0]!.messages[0]).toMatchObject({ threshold: -30 });
  });

  it("rebuilds the saturation curve for the selected shape", () => {
    const c = ctx();
    buildFxNode(asCtx(c), "saturate", { ...defaultAudioFxParams("saturate"), type: "hard" });
    const ws = c.created.find((n) => n.kind === "waveshaper")!;
    expect(ws.curve).toBeInstanceOf(Float32Array);
    // A hard clip saturates to the threshold and stays flat at the extremes.
    expect(ws.curve!.at(-1)).toBeCloseTo(ws.curve![ws.curve!.length - 2]!, 6);
  });
});

describe("buildFxChain", () => {
  it("passes audio straight through for an empty chain", () => {
    const c = ctx();
    const h = buildFxChain(asCtx(c), { version: 1, nodes: [] });
    expect(h.input.connect).toBeDefined();
    expect((h.input as unknown as FakeNode).connections).toContain(h.output);
  });

  it("chains effects in order", () => {
    const c = ctx();
    const h = buildFxChain(asCtx(c), chain("highpass", "peaking"));
    // input -> highpass -> peaking -> output, so input reaches exactly one node.
    expect((h.input as unknown as FakeNode).connections).toHaveLength(1);
    expect(c.created.filter((n) => n.kind === "biquad")).toHaveLength(2);
  });

  it("skips bypassed nodes", () => {
    const c = ctx();
    buildFxChain(asCtx(c), {
      version: 1,
      nodes: [
        { type: "peaking", enabled: false, params: defaultAudioFxParams("peaking") },
        { type: "lowpass", enabled: true, params: defaultAudioFxParams("lowpass") },
      ],
    });
    expect(c.created.filter((n) => n.kind === "biquad")).toHaveLength(1);
  });

  it("updates in place when only values changed", () => {
    const c = ctx();
    const h = buildFxChain(asCtx(c), chain("peaking"));
    const before = c.created.length;
    const ok = h.update({
      version: 1,
      nodes: [{ type: "peaking", enabled: true, params: { frequency: 2000, gain: 5, q: 2 } }],
    });
    expect(ok).toBe(true);
    expect(c.created.length).toBe(before); // nothing rebuilt
    expect(c.created.find((x) => x.kind === "biquad")!.frequency.value).toBe(2000);
  });

  it("reports that a rebuild is needed when the chain shape changes", () => {
    const c = ctx();
    const h = buildFxChain(asCtx(c), chain("peaking"));
    expect(h.update(chain("peaking", "lowpass"))).toBe(false);
    expect(h.update(chain("lowpass"))).toBe(false);
  });

  it("treats a pole-count change as a rebuild, since it changes the node type", () => {
    const c = ctx();
    const h = buildFxChain(asCtx(c), chain("highpass"));
    expect(
      h.update({
        version: 1,
        nodes: [
          {
            type: "highpass",
            enabled: true,
            params: { ...defaultAudioFxParams("highpass"), poles: "1" },
          },
        ],
      }),
    ).toBe(false);
  });

  it("treats bypassing a node as a shape change", () => {
    const c = ctx();
    const h = buildFxChain(asCtx(c), chain("peaking", "lowpass"));
    expect(
      h.update({
        version: 1,
        nodes: [
          { type: "peaking", enabled: true, params: defaultAudioFxParams("peaking") },
          { type: "lowpass", enabled: false, params: defaultAudioFxParams("lowpass") },
        ],
      }),
    ).toBe(false);
  });

  it("disconnects everything it made on dispose", () => {
    const c = ctx();
    const h = buildFxChain(asCtx(c), chain("delay"));
    h.dispose();
    expect(c.created.every((n) => n.disconnected)).toBe(true);
  });
});

describe("chainNeedsWorklets", () => {
  it("is true only when the chain contains a worklet-backed effect", () => {
    expect(chainNeedsWorklets(chain("peaking", "delay"))).toBe(false);
    expect(chainNeedsWorklets(chain("peaking", "compressor"))).toBe(true);
  });
});

describe("synthesizeReverbImpulse", () => {
  it("is deterministic for the same room, so preview and render convolve the same tail", () => {
    const a = synthesizeReverbImpulse(48000, 0.7, 0.5);
    const b = synthesizeReverbImpulse(48000, 0.7, 0.5);
    expect(Array.from(a.slice(0, 64))).toEqual(Array.from(b.slice(0, 64)));
  });

  it("varies with the room and decays to near-silence", () => {
    const small = synthesizeReverbImpulse(48000, 0.1, 0.5);
    const large = synthesizeReverbImpulse(48000, 1.0, 0.5);
    expect(large.length).toBeGreaterThan(small.length);
    const tail = large.subarray(large.length - 128);
    expect(Math.max(...Array.from(tail, Math.abs))).toBeLessThan(0.01);
  });
});

describe("automatable parameters", () => {
  /**
   * The registry's `automatable` flag is what the panel and the scheduler both
   * trust, and it is written by hand. Build every effect and check that each
   * flagged knob really does reach an AudioParam — a flag that lies would
   * offer an automation lane that silently does nothing.
   */
  it("exposes an AudioParam for every knob the registry marks automatable", () => {
    for (const def of HF_AUDIO_FX) {
      const ctx = new FakeCtx() as unknown as BaseAudioContext;
      const handle = buildFxNode(ctx, def.id, defaultAudioFxParams(def.id));
      const flagged = def.params
        .filter((p) => p.kind === "number" && p.automatable)
        .map((p) => p.key);
      for (const key of flagged) {
        const targets = handle.automation?.[key];
        expect(
          targets,
          `${def.id}.${key} is flagged automatable but exposes no AudioParam`,
        ).toBeTruthy();
        expect(targets?.length, `${def.id}.${key} exposes an empty target list`).toBeGreaterThan(0);
      }
    }
  });

  it("exposes nothing the registry has not flagged", () => {
    for (const def of HF_AUDIO_FX) {
      const ctx = new FakeCtx() as unknown as BaseAudioContext;
      const handle = buildFxNode(ctx, def.id, defaultAudioFxParams(def.id));
      const flagged = new Set(
        def.params.filter((p) => p.kind === "number" && p.automatable).map((p) => p.key),
      );
      for (const key of Object.keys(handle.automation ?? {})) {
        expect(flagged.has(key), `${def.id}.${key} is exposed but not flagged automatable`).toBe(
          true,
        );
      }
    }
  });

  it("maps a knob's own unit onto the AudioParam it drives", () => {
    const ctx = new FakeCtx() as unknown as BaseAudioContext;
    const delay = buildFxNode(ctx, "delay", { ...defaultAudioFxParams("delay"), time: 250 });
    // The knob reads milliseconds; delayTime is in seconds.
    expect(delay.automation?.time?.[0]?.map?.(250)).toBeCloseTo(0.25, 10);
    // A wet/dry mix is two gains moving in opposition, not one.
    const mix = delay.automation?.mix ?? [];
    expect(mix.length).toBe(2);
    expect(mix[0]?.map?.(0.3) ?? 0.3).toBeCloseTo(0.3, 10);
    expect(mix[1]?.map?.(0.3)).toBeCloseTo(0.7, 10);
  });

  it("leaves a one-pole filter unexposed, since its coefficients are fixed", () => {
    const ctx = new FakeCtx() as unknown as BaseAudioContext;
    const twoPole = buildFxNode(ctx, "highpass", defaultAudioFxParams("highpass"));
    expect(twoPole.automation?.frequency?.length).toBe(1);
    const onePole = buildFxNode(ctx, "highpass", {
      ...defaultAudioFxParams("highpass"),
      poles: "1",
    });
    expect(onePole.automation?.frequency).toBeUndefined();
  });
});
