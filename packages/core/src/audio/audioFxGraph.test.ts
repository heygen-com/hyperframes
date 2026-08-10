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
  playbackRate = new FakeParam();
  loop = false;
  type = "";
  curve: Float32Array | null = null;
  oversample = "none";
  buffer: FakeBuffer | null = null;
  normalize = true;
  port = { postMessage: (m: unknown) => this.messages.push(m) };
  messages: unknown[] = [];
  /** `start(when, offset)` — the offset is the LFO's phase, so it is asserted. */
  startArgs: (number | undefined)[] | null = null;
  constructor(public kind: string) {}
  connect(next: FakeNode): FakeNode {
    this.connections.push(next);
    return next;
  }
  disconnect(): void {
    this.disconnected = true;
  }
  start(...args: (number | undefined)[]): void {
    this.startArgs = args;
  }
  stop(): void {}
}

/** One channel, kept across `getChannelData` calls so what is written can be read. */
class FakeBuffer {
  private data: Float32Array;
  constructor(public length: number) {
    this.data = new Float32Array(length);
  }
  getChannelData(): Float32Array {
    return this.data;
  }
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
  createBufferSource() {
    return this.make("bufferSource");
  }
  createWaveShaper() {
    return this.make("waveshaper");
  }
  createConvolver() {
    return this.make("convolver");
  }
  createBuffer(_c: number, length: number) {
    return new FakeBuffer(length);
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

  it("tells a worklet processor to retire on dispose, not just disconnect it", () => {
    // Disconnecting leaves the processor alive — it lives until `process()`
    // returns false — so every rebuild that dropped a worklet effect left one
    // running on the audio thread for the rest of the session.
    workletNodes.length = 0;
    const h = buildFxNode(asCtx(ctx()), "compressor", defaultAudioFxParams("compressor"));
    h.dispose();
    expect(workletNodes[0]!.messages).toEqual([{ __hfDispose: true }]);
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

  it("lines new values up against the built nodes, skipping a bypassed one", () => {
    // A bypassed node is not in the graph, so the update has to walk the
    // ENABLED nodes to stay aligned with what was built. Walking `next.nodes`
    // instead shifts everything after the bypass by one and pushes each node's
    // parameters into its neighbour — and the shape is unchanged either way,
    // so nothing forces a rebuild that would hide it.
    const c = ctx();
    const withBypass = (frequency: number): HfAudioFxChain => ({
      version: 1,
      nodes: [
        {
          type: "highpass",
          enabled: true,
          params: { ...defaultAudioFxParams("highpass"), frequency: 100 },
        },
        { type: "peaking", enabled: false, params: defaultAudioFxParams("peaking") },
        {
          type: "lowpass",
          enabled: true,
          params: { ...defaultAudioFxParams("lowpass"), frequency },
        },
      ],
    });
    const h = buildFxChain(asCtx(c), withBypass(8000));
    const biquads = c.created.filter((n) => n.kind === "biquad");
    expect(biquads).toHaveLength(2);

    expect(h.update(withBypass(3000))).toBe(true);
    // The lowpass took the new cutoff; the highpass was left where it was.
    expect(biquads[0]!.frequency.value).toBe(100);
    expect(biquads[1]!.frequency.value).toBe(3000);
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

describe("levels and per-channel state", () => {
  const energy = (ir: Float32Array): number => {
    let e = 0;
    for (const v of ir) e += v * v;
    return Math.sqrt(e);
  };

  it("normalises the reverb impulse, so adding one does not clip the mix", () => {
    // A ConvolverNode applies the impulse's gain whole (normalize is off so the
    // room is deterministic). Raw decaying noise ran to +33 dB at the registry
    // default, which put the wet path ~24 dB over dry at wet: 0.35.
    for (const [size, damping] of [
      [0.7, 0.5],
      [1, 0],
      [0, 1],
      [0.5, 0.5],
    ]) {
      expect(energy(synthesizeReverbImpulse(48000, size, damping))).toBeCloseTo(1, 5);
    }
  });

  it("keeps a phaser at unity, rather than summing its two gains above it", () => {
    // in_gain/out_gain trim what enters and leaves the effect; wired as a wet/dry
    // pair their defaults summed to 1.14, so inserting a phaser raised the level.
    const ctx = new FakeCtx();
    buildFxNode(ctx as unknown as BaseAudioContext, "phaser", defaultAudioFxParams("phaser"));
    const gains = ctx.created.filter((n) => n.kind === "gain").map((n) => n.gain.value);
    // The wet and dry legs are summed at unity; the trims carry the knob values.
    expect(gains.filter((g) => g === 1).length).toBeGreaterThanOrEqual(2);
  });

  it("sets the phaser LFO waveform it declares", () => {
    // A quarter of the way through the cycle both waveforms peak at 1, so the
    // eighth is where they part: a sine is at sin(π/4), a triangle halfway up.
    const eighth = (c: FakeCtx): number => {
      const buffer = c.created.find((n) => n.kind === "bufferSource")?.buffer;
      if (!buffer) throw new Error("no LFO buffer");
      return buffer.getChannelData()[Math.round(buffer.length / 8)] ?? 0;
    };
    const build = (type: string): FakeCtx => {
      const c = new FakeCtx();
      buildFxNode(c as unknown as BaseAudioContext, "phaser", {
        ...defaultAudioFxParams("phaser"),
        type,
      });
      return c;
    };
    expect(eighth(build("0"))).toBeCloseTo(0.5, 3);
    expect(eighth(build("1"))).toBeCloseTo(Math.SQRT1_2, 3);
  });

  /**
   * The waveform is baked into a buffer at construction, so pushing a type change
   * into the running graph would be a no-op — preview would keep sweeping on a
   * triangle while the render used the sine the attribute now says.
   */
  it("rebuilds a phaser when its LFO waveform changes", () => {
    const phaser = (params: Record<string, number | string>): HfAudioFxChain => ({
      version: 1,
      nodes: [
        {
          type: "phaser",
          enabled: true,
          params: { ...defaultAudioFxParams("phaser"), type: "0", ...params },
        },
      ],
    });
    const built = buildFxChain(asCtx(ctx()), phaser({}));
    expect(built.update(phaser({ type: "1" }))).toBe(false);
    // Everything else about a phaser still updates in place.
    const other = buildFxChain(asCtx(ctx()), phaser({}));
    expect(other.update(phaser({ speed: 2 }))).toBe(true);
  });

  /**
   * An LFO's phase is the whole reason it is a looping buffer rather than an
   * OscillatorNode, whose phase is zero at `start()` and cannot be set.
   *
   * Preview rebuilds the graph mid-play — a seek, a scrub, any structural edit —
   * and an oscillator restarted there put the chorus at the top of its sweep
   * wherever the playhead happened to be, so preview disagreed with the render
   * and with itself across an edit.
   */
  it("starts a modulated effect's LFO at the phase the clip has reached", () => {
    // 3.5 s at 2 Hz is seven whole cycles: back at phase zero.
    const whole = ctx();
    buildFxNode(asCtx(whole), "chorus", { ...defaultAudioFxParams("chorus"), speed: 2 }, 3.5);
    expect(whole.created.find((n) => n.kind === "bufferSource")?.startArgs?.[1]).toBeCloseTo(0, 6);
    // 3.6 s at 2 Hz is seven cycles and a fifth.
    const part = ctx();
    buildFxNode(asCtx(part), "chorus", { ...defaultAudioFxParams("chorus"), speed: 2 }, 3.6);
    const src = part.created.find((n) => n.kind === "bufferSource");
    expect(src?.startArgs?.[1]).toBeCloseTo(0.2, 6);
    expect(src?.loop).toBe(true);
    // One second of waveform: the rate reads in Hz, so a speed lane needs no map.
    expect(src?.playbackRate.value).toBeCloseTo(2, 6);
  });

  /**
   * A source node is not retired by disconnecting what it feeds. The chorus and
   * phaser stopped their LFO and left it out of the nodes they disconnect, so
   * every rebuild that dropped one left a modulator still wired to the delay or
   * the allpass bank it had been driving.
   */
  it("unwires a modulated effect's LFO when the effect is disposed", () => {
    for (const type of ["chorus", "phaser"]) {
      const c = ctx();
      buildFxNode(asCtx(c), type, defaultAudioFxParams(type)).dispose();
      const lfo = c.created.find((node) => node.kind === "bufferSource");
      expect(lfo?.disconnected, `${type} left its LFO connected`).toBe(true);
    }
  });

  it("starts the LFO at zero for a render, which always begins at the clip's start", () => {
    const c = ctx();
    buildFxNode(asCtx(c), "phaser", defaultAudioFxParams("phaser"));
    expect(c.created.find((n) => n.kind === "bufferSource")?.startArgs?.[1]).toBe(0);
  });

  it("rebuilds a one-pole filter when its cutoff moves", () => {
    // Its coefficients are fixed at construction, so a cutoff change cannot be
    // pushed into the running graph — preview kept filtering at the old
    // frequency while the render used the new one.
    const ctx = new FakeCtx() as unknown as BaseAudioContext;
    const chain = (frequency: number): HfAudioFxChain => ({
      version: 1,
      nodes: [{ type: "highpass", enabled: true, params: { frequency, q: 0.707, poles: "1" } }],
    });
    const built = buildFxChain(ctx, chain(300));
    expect(built.update(chain(2000))).toBe(false);
    // A two-pole filter is a BiquadFilterNode and still updates in place.
    const twoPole = (frequency: number): HfAudioFxChain => ({
      version: 1,
      nodes: [{ type: "highpass", enabled: true, params: { frequency, q: 0.707, poles: "2" } }],
    });
    expect(buildFxChain(ctx, twoPole(300)).update(twoPole(2000))).toBe(true);
  });
});

describe("gain stage", () => {
  /**
   * A level control the chain owns, so a carve can make broadband room for a
   * voice without touching the track's own volume lane — which belongs to the
   * author, and which a carve re-run would otherwise have to overwrite.
   */
  it("sets a GainNode from a value in dB", () => {
    const c = ctx();
    buildFxNode(c as unknown as BaseAudioContext, "gain", { gain: -6 });
    const node = c.created.find((x) => x.kind === "gain");
    expect(node).toBeTruthy();
    expect(node!.gain.value).toBeCloseTo(0.501, 3);
  });

  it("passes unity through at 0 dB", () => {
    const c = ctx();
    buildFxNode(c as unknown as BaseAudioContext, "gain", { gain: 0 });
    expect(c.created.find((x) => x.kind === "gain")!.gain.value).toBeCloseTo(1, 6);
  });

  it("maps an automation lane's dB into the AudioParam's linear units", () => {
    // The lane is authored in the knob's own unit — dB, like every other gain in
    // the registry — but a GainNode's param is a linear multiplier. Without the
    // mapping, a lane point of -12 would schedule a gain of -12: a phase flip
    // twelve times too loud, not a cut.
    const handle = buildFxNode(ctx() as unknown as BaseAudioContext, "gain", { gain: 0 });
    const target = handle.automation?.gain?.[0];
    expect(target?.map).toBeTypeOf("function");
    expect(target!.map!(-12)).toBeCloseTo(0.251, 3);
    expect(target!.map!(0)).toBeCloseTo(1, 6);
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

describe("phaser automation targets", () => {
  /**
   * `in_gain` and `out_gain` trim the signal entering and leaving the effect,
   * which the builder drives through inTrim/outTrim while pinning wet and dry
   * to 1. The automation map used to aim both lanes at wet/dry — so an envelope
   * modulated a constant, the trim it was supposed to move stayed frozen, and
   * "fade the phaser out" left the dry leg playing at full level.
   *
   * Asserted by VALUE rather than by node identity: the trims are internal, and
   * the only honest question is whether the param a lane would drive is the one
   * the knob sets.
   */
  it("drives the trims a lane is named for, not the pinned wet/dry pair", () => {
    const handle = buildFxNode(ctx() as unknown as BaseAudioContext, "phaser", {
      ...defaultAudioFxParams("phaser"),
      in_gain: 0.25,
      out_gain: 0.5,
    });
    expect(handle.automation?.in_gain?.[0]?.param.value).toBeCloseTo(0.25, 6);
    expect(handle.automation?.out_gain?.[0]?.param.value).toBeCloseTo(0.5, 6);
  });
});

describe("chain update keeps ids with their effects", () => {
  const band = (id: string, frequency: number) => ({
    type: "peaking",
    id,
    enabled: true,
    params: { ...defaultAudioFxParams("peaking"), frequency },
  });

  /**
   * Reordering two effects of the same type leaves the shape string identical,
   * so the chain updates in place rather than rebuilding — correct for the
   * audio, since the params move with the position. The ids have to move too:
   * a lane addresses its effect by id, and an id captured at build time names
   * whichever effect used to occupy that slot. The scheduler would then drive
   * `fx.n2.frequency` into the band that is now n1 — the exact swap that
   * HfAudioFxNode.id documents itself as preventing, and the one the voiceover
   * carve's all-peaking chains make easy to hit.
   */
  it("moves an id with its slot when same-type effects are reordered", () => {
    const chain: HfAudioFxChain = { version: 1, nodes: [band("n1", 200), band("n2", 4000)] };
    const handle = buildFxChain(ctx() as unknown as BaseAudioContext, chain);

    const swapped: HfAudioFxChain = { version: 1, nodes: [band("n2", 4000), band("n1", 200)] };
    expect(handle.update(swapped)).toBe(true);
    expect(handle.nodes.map((n) => n.id)).toEqual(["n2", "n1"]);
  });
});
