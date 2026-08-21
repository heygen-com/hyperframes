// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { attachElementFxChain } from "./audioFx.js";
import { defaultAudioFxParams, HF_AUDIO_FX, HF_AUDIO_FX_ATTR } from "../audioFx.js";

/**
 * The DSP is proven in a real browser by the engine's render tests. What needs
 * covering here is the splice: whether the chain gets inserted between the
 * transport's source and its gain, and whether it stays out of the way when
 * there is nothing to apply.
 */
class Node {
  connections: Node[] = [];
  disconnected = false;
  frequency = { value: 0 };
  Q = { value: 0 };
  gain = { value: 0 };
  delayTime = { value: 0 };
  playbackRate = { value: 0 };
  loop = false;
  /** `start(when, offset)` — the offset is an LFO's phase, so it is asserted. */
  startArgs: (number | undefined)[] | null = null;
  type = "";
  curve: Float32Array | null = null;
  oversample = "none";
  buffer: unknown = null;
  normalize = true;
  connect(n: Node): Node {
    this.connections.push(n);
    return n;
  }
  disconnect(): void {
    this.disconnected = true;
  }
  start(...args: (number | undefined)[]): void {
    this.startArgs = args;
  }
  stop(): void {}
}
class Ctx {
  sampleRate = 48000;
  createGain() {
    return new Node();
  }
  createBiquadFilter() {
    return new Node();
  }
  createIIRFilter() {
    return new Node();
  }
  createDelay() {
    return new Node();
  }
  createOscillator() {
    return new Node();
  }
  createBufferSource() {
    return new Node();
  }
  createWaveShaper() {
    return new Node();
  }
  createConvolver() {
    return new Node();
  }
  createBuffer(_c: number, length: number) {
    return { length, getChannelData: () => new Float32Array(length) };
  }
}
const ctx = () => new Ctx() as unknown as BaseAudioContext;
const el = (chain?: unknown) => ({
  getAttribute: (n: string) => (n === "data-fx-chain" && chain ? JSON.stringify(chain) : null),
});
const CHAIN = {
  version: 1,
  nodes: [{ type: "peaking", params: { frequency: 1000, gain: -6, q: 1 } }],
};

describe("attachElementFxChain", () => {
  it("connects source straight to destination when there is no chain", () => {
    const src = new Node();
    const dst = new Node();
    attachElementFxChain(ctx(), el(), src as never, dst as never);
    expect(src.connections).toContain(dst);
  });

  it("routes through the chain instead of directly when one is present", () => {
    const src = new Node();
    const dst = new Node();
    const handle = attachElementFxChain(ctx(), el(CHAIN), src as never, dst as never);
    expect(handle).not.toBeNull();
    // The whole point: the dry path must no longer exist.
    expect(src.connections).not.toContain(dst);
    expect(src.connections).toHaveLength(1);
  });

  it("tolerates an element that cannot carry attributes", () => {
    // The transport's element is any media-like object in some call paths.
    const src = new Node();
    const dst = new Node();
    expect(() => attachElementFxChain(ctx(), {}, src as never, dst as never)).not.toThrow();
    expect(src.connections).toContain(dst);
  });

  it("plays dry rather than silent when the chain is unreadable", () => {
    const src = new Node();
    const dst = new Node();
    const handle = attachElementFxChain(
      ctx(),
      {
        getAttribute: (name: string) => (name === HF_AUDIO_FX_ATTR ? "{not json" : null),
      },
      src as never,
      dst as never,
    );
    expect(handle).not.toBeNull();
    expect(src.connections).toContain(dst);
  });

  it("plays dry rather than silent when the chain names an unknown effect", () => {
    const src = new Node();
    const dst = new Node();
    const handle = attachElementFxChain(
      ctx(),
      el({ version: 1, nodes: [{ type: "not-an-effect" }] }),
      src as never,
      dst as never,
    );
    expect(handle).not.toBeNull();
    expect(src.connections).toContain(dst);
  });

  /**
   * A structural edit — an effect added, removed or bypassed — used to be
   * ignored here, so it only took effect when the persisting write reloaded the
   * composition. That reload restarted every playing track, which is what was
   * heard as the audio chopping. The graph is now swapped in place instead, with
   * the source node left alone.
   */
  describe("editing the chain while it plays", () => {
    const audioEl = (chain?: unknown): HTMLElement => {
      const node = document.createElement("audio");
      if (chain) node.setAttribute("data-fx-chain", JSON.stringify(chain));
      document.body.append(node);
      return node;
    };
    /** Let the MutationObserver's microtask run. */
    const settle = () => new Promise((r) => setTimeout(r, 0));

    it("routes through an effect added to a track that had none", async () => {
      const src = new Node();
      const dst = new Node();
      const node = audioEl();
      attachElementFxChain(ctx(), node, src as never, dst as never);
      expect(src.connections).toContain(dst);

      node.setAttribute("data-fx-chain", JSON.stringify(CHAIN));
      await settle();
      // Now feeding the chain, not the gain directly.
      expect(src.connections.at(-1)).not.toBe(dst);
    });

    it("returns to dry when the last effect is removed", async () => {
      const src = new Node();
      const dst = new Node();
      const node = audioEl(CHAIN);
      attachElementFxChain(ctx(), node, src as never, dst as never);
      const firstTarget = src.connections[0] as Node;
      expect(firstTarget).not.toBe(dst);

      node.removeAttribute("data-fx-chain");
      await settle();
      expect(src.connections.at(-1)).toBe(dst);
      // The graph that was in the path is torn down, not left running.
      expect(firstTarget.disconnected).toBe(true);
    });

    it("swaps the graph without replacing the source node", async () => {
      const src = new Node();
      const dst = new Node();
      const node = audioEl(CHAIN);
      attachElementFxChain(ctx(), node, src as never, dst as never);
      const before = src.connections[0] as Node;

      node.setAttribute(
        "data-fx-chain",
        JSON.stringify({
          version: 1,
          nodes: [
            { type: "peaking", params: { frequency: 1000, gain: -6, q: 1 } },
            { type: "lowpass", params: { frequency: 800, q: 0.7, poles: "2" } },
          ],
        }),
      );
      await settle();
      const after = src.connections.at(-1) as Node;
      // A different graph, reached from the same source: the audio never restarts.
      expect(after).not.toBe(before);
      expect(before.disconnected).toBe(true);
    });

    const violations: string[] = [];

    /**
     * An AudioParam with the browser's own scheduling rule: writing `.value`
     * while a value curve covers the current time throws, because setting the
     * property is a `setValueAtTime` at that instant and a curve may not overlap
     * another event. Chrome words it exactly as this does.
     */
    class SchedParam {
      curves: { time: number; duration: number }[] = [];
      sets: number[] = [];
      #value = 0;
      constructor(private clock: { currentTime: number }) {}
      get value(): number {
        return this.#value;
      }
      set value(v: number) {
        const t = this.clock.currentTime;
        const covering = this.curves.find((c) => t >= c.time && t <= c.time + c.duration);
        if (covering) {
          // Recorded as well as thrown: the throw happens inside a
          // MutationObserver callback, where nothing rethrows it into the test —
          // which is exactly why this only ever showed up as an uncaught error
          // in the preview console.
          const message =
            `Failed to set the 'value' property on 'AudioParam': setValueAtTime(${v}, ${t}) ` +
            `overlaps setValueCurveAtTime(..., ${covering.time}, ${covering.duration})`;
          violations.push(message);
          throw new Error(message);
        }
        this.#value = v;
      }
      setValueAtTime(v: number, t: number): void {
        this.sets.push(t);
        this.#value = v;
      }
      linearRampToValueAtTime(v: number): void {
        this.#value = v;
      }
      setValueCurveAtTime(_v: Float32Array, time: number, duration: number): void {
        this.curves.push({ time, duration });
      }
      cancelScheduledValues(from: number): void {
        this.curves = this.curves.filter((c) => c.time + c.duration < from);
      }
      cancelAndHoldAtTime(from: number): void {
        this.cancelScheduledValues(from);
      }
    }

    it("edits a chain whose parameters an envelope is mid-curve on", async () => {
      // The level stage a carve adds is automated, so a chain edit lands while a
      // curve is running. Writing the new value straight onto the param throws
      // NotSupportedError, which surfaced in the console as the preview refusing
      // every edit after the first.
      const clock = { currentTime: 0 };
      class SchedNode extends Node {
        override frequency = new SchedParam(clock) as unknown as { value: number };
        override Q = new SchedParam(clock) as unknown as { value: number };
        override gain = new SchedParam(clock) as unknown as { value: number };
      }
      class SchedCtx extends Ctx {
        get currentTime(): number {
          return clock.currentTime;
        }
        override createGain(): Node {
          return new SchedNode();
        }
        override createBiquadFilter(): Node {
          return new SchedNode();
        }
      }
      // A gain stage, because its dB-to-linear mapping is what makes the
      // scheduler emit a value curve instead of a ramp — and a curve is what a
      // `.value` write may not land inside.
      const chainWith = (freq: number) => ({
        version: 1,
        nodes: [
          { type: "gain", id: "n1", params: { gain: 0 } },
          { type: "peaking", id: "n2", params: { frequency: freq, gain: -6, q: 1 } },
        ],
      });
      const node = audioEl(chainWith(1000));
      // A bent segment, so the scheduler emits a curve rather than a ramp.
      node.setAttribute(
        "data-automation",
        JSON.stringify({
          version: 1,
          lanes: [
            {
              target: "fx.n1.gain",
              points: [
                { t: 0, v: 0 },
                { t: 8, v: -12 },
              ],
            },
          ],
        }),
      );
      attachElementFxChain(
        new SchedCtx() as unknown as BaseAudioContext,
        node,
        new Node() as never,
        new Node() as never,
        { scheduledAt: 0, elapsed: 0, rate: 1 },
      );

      // Mid-curve, which is when the edit has to survive.
      clock.currentTime = 3;
      node.setAttribute("data-fx-chain", JSON.stringify(chainWith(1200)));
      await settle();

      expect(violations).toEqual([]);
      expect(node.getAttribute("data-fx-chain")).toContain("1200");
    });

    /**
     * A rebuild hands the graph the clip position it happens at, so an LFO
     * resumes at the phase the render would be at rather than restarting.
     *
     * Without it, every structural edit — and every seek, which rebuilds the same
     * way — put a chorus back at the top of its sweep wherever the playhead was:
     * preview disagreeing with the render, and with itself across an edit.
     */
    it("hands a rebuilt graph the playhead it happens at", async () => {
      const clock = { currentTime: 0 };
      class ClockCtx extends Ctx {
        made: Node[] = [];
        get currentTime(): number {
          return clock.currentTime;
        }
        override createBufferSource(): Node {
          const node = new Node();
          this.made.push(node);
          return node;
        }
      }
      const withChorus = (mix: number) => ({
        version: 1,
        nodes: [
          {
            type: "chorus",
            id: "n1",
            params: { ...defaultAudioFxParams("chorus"), speed: 2, mix },
          },
        ],
      });
      const ctxClock = new ClockCtx();
      const node = audioEl(withChorus(0.5));
      attachElementFxChain(
        ctxClock as unknown as BaseAudioContext,
        node,
        new Node() as never,
        new Node() as never,
        { scheduledAt: 0, elapsed: 0, rate: 1 },
      );
      // Attached at the clip's start: phase zero, the same as a render.
      expect(ctxClock.made[0]?.startArgs?.[1]).toBeCloseTo(0, 6);

      // 3.6 s later, and structural — a bypass, so the shape changes and the
      // graph is rebuilt rather than re-parameterised.
      clock.currentTime = 3.6;
      node.setAttribute(
        "data-fx-chain",
        JSON.stringify({
          version: 1,
          nodes: [
            ...withChorus(0.5).nodes,
            { type: "peaking", id: "n2", params: defaultAudioFxParams("peaking") },
          ],
        }),
      );
      await settle();
      // 3.6 s at 2 Hz is seven cycles and a fifth.
      expect(ctxClock.made.at(-1)?.startArgs?.[1]).toBeCloseTo(0.2, 6);
    });

    it("keeps playing dry when an edit leaves the chain unreadable", async () => {
      const src = new Node();
      const dst = new Node();
      const node = audioEl(CHAIN);
      attachElementFxChain(ctx(), node, src as never, dst as never);
      node.setAttribute("data-fx-chain", "{not json");
      await settle();
      expect(src.connections.at(-1)).toBe(dst);
    });
  });

  /**
   * Lanes are committed to absolute context times, so the schedule is only
   * right for the rate it was booked at. Bumping `playbackRate` alone left a
   * lowpass sweeping over its original 10 wall-clock seconds while the audio
   * underneath ran through 20 clip-seconds of material — and the runtime's
   * stopAll()+reschedule recovery never fired for an unbounded source.
   */
  describe("a rate change mid-playback", () => {
    /** Records what was booked and when, without the browser's overlap rules. */
    class TimedParam {
      curves: { time: number; duration: number }[] = [];
      ramps: number[] = [];
      value = 0;
      setValueAtTime(v: number): void {
        this.value = v;
      }
      linearRampToValueAtTime(v: number, t: number): void {
        this.ramps.push(t);
        this.value = v;
      }
      setValueCurveAtTime(_v: Float32Array, time: number, duration: number): void {
        this.curves.push({ time, duration });
      }
      cancelScheduledValues(): void {}
      cancelAndHoldAtTime(): void {}
      /** The last span booked, however the scheduler chose to express it. */
      last(): { time: number; duration: number } | undefined {
        return this.curves.at(-1);
      }
    }

    const sweep = {
      version: 1,
      nodes: [{ type: "lowpass", id: "n1", params: { frequency: 300, q: 0.707 } }],
    };
    const lane = JSON.stringify({
      version: 1,
      lanes: [
        {
          target: "fx.n1.frequency",
          points: [
            { t: 0, v: 300 },
            { t: 8, v: 3000 },
          ],
        },
      ],
    });

    const build = () => {
      const clock = { currentTime: 0 };
      const made: { frequency: TimedParam }[] = [];
      class TimedNode extends Node {
        override frequency = new TimedParam() as unknown as { value: number };
      }
      class TimedCtx extends Ctx {
        get currentTime(): number {
          return clock.currentTime;
        }
        override createBiquadFilter(): Node {
          const n = new TimedNode();
          made.push(n as unknown as { frequency: TimedParam });
          return n;
        }
      }
      const node = document.createElement("audio");
      node.setAttribute("data-fx-chain", JSON.stringify(sweep));
      node.setAttribute("data-automation", lane);
      document.body.append(node);
      const handle = attachElementFxChain(
        new TimedCtx() as unknown as BaseAudioContext,
        node,
        new Node() as never,
        new Node() as never,
        { scheduledAt: 0, elapsed: 0, rate: 1 },
      );
      return { clock, node, handle, param: () => made[0]?.frequency as unknown as TimedParam };
    };

    it("re-aims the envelope so the sweep still ends with the material", () => {
      const { clock, handle, param } = build();
      // Booked at 1x: the whole 8 s lane spans 8 s of context time.
      expect(param().last()).toEqual({ time: 0, duration: 8 });

      clock.currentTime = 2;
      handle?.setRate(2);

      // 6 clip-seconds are left, and at 2x they take 3 wall-clock seconds.
      // Without this the sweep kept its original plan to t=8 while the audio
      // ran out at t=5.
      expect(param().last()).toEqual({ time: 2, duration: 3 });
    });

    it("measures later edits from the new rate, not the one it started at", async () => {
      // `elapsed` advances at whatever rate the reference frame holds, so a
      // frame left at 1x re-aims every subsequent edit at the wrong clip
      // position for as long as the track plays.
      const { clock, node, handle, param } = build();
      clock.currentTime = 2;
      handle?.setRate(2);

      clock.currentTime = 4;
      // 2 wall-clock seconds at 2x is 4 clip-seconds, so the playhead is at 6
      // and 2 clip-seconds remain: 1 second of wall clock.
      node.setAttribute("data-automation", lane);
      await new Promise((r) => setTimeout(r, 0));
      expect(param().last()).toEqual({ time: 4, duration: 1 });
    });

    it("ignores a rate that is not a rate", () => {
      const { clock, handle, param } = build();
      clock.currentTime = 2;
      handle?.setRate(0);
      handle?.setRate(Number.NaN);
      handle?.setRate(1);
      expect(param().last()).toEqual({ time: 0, duration: 8 });
    });
  });

  it("tears the chain down on dispose", () => {
    const src = new Node();
    const dst = new Node();
    const handle = attachElementFxChain(ctx(), el(CHAIN), src as never, dst as never);
    handle!.dispose();
    expect((src.connections[0] as Node).disconnected).toBe(true);
  });

  /**
   * A limiter, a compressor, a gate and a bitcrush are AudioWorklet processors,
   * and a worklet node cannot be constructed before its module has registered. So
   * a chain containing one plays dry for a moment and swaps in when registration
   * resolves — and that path used to end there: no automation scheduled, no
   * observer watching the attribute. Adding a compressor to a carved bed
   * therefore killed the carve's envelopes and froze every later edit until the
   * composition reloaded.
   */
  describe("a chain that needs worklets before it can be built", () => {
    /**
     * Constructs only once the module has registered on that context, which is
     * what Chrome does — and the whole reason this path exists. A stub that always
     * succeeds hides the bug: the build then works even when nothing registered.
     */
    class WorkletNodeStub extends Node {
      port = { postMessage: () => {} };
      constructor(ctx: { workletsReady?: boolean }, name: string) {
        super("worklet");
        if (!ctx.workletsReady) {
          throw new Error(`AudioWorkletNode: processor "${name}" is not registered`);
        }
      }
    }

    /** A param that records whether an envelope was ever scheduled onto it. */
    class RecordingParam {
      scheduled = false;
      value = 0;
      setValueAtTime(): void {
        this.scheduled = true;
      }
      linearRampToValueAtTime(): void {
        this.scheduled = true;
      }
      setValueCurveAtTime(): void {
        this.scheduled = true;
      }
      cancelScheduledValues(): void {}
      cancelAndHoldAtTime(): void {}
    }

    /**
     * A context whose worklet module registers when asked, and which hands out
     * filters whose gain reports being automated.
     */
    class WorkletCtx extends Ctx {
      currentTime = 0;
      workletsReady = false;
      audioWorklet = {
        addModule: async () => {
          this.workletsReady = true;
        },
      };
      biquads: { gain: RecordingParam }[] = [];
      override createBiquadFilter() {
        const node = new Node("biquad") as unknown as Node & { gain: RecordingParam };
        node.gain = new RecordingParam();
        this.biquads.push(node);
        return node as unknown as Node;
      }
    }

    const carved = {
      version: 1,
      nodes: [
        {
          type: "peaking",
          id: "n1",
          fromCarve: true,
          params: { frequency: 1000, gain: -6, q: 1.4 },
        },
        { type: "compressor", id: "n2", params: {} },
      ],
    };
    const lane = JSON.stringify({
      version: 1,
      lanes: [
        {
          target: "fx.n1.gain",
          points: [
            { t: 0, v: 0 },
            { t: 4, v: -6 },
          ],
        },
      ],
    });

    const audioEl = (): HTMLElement => {
      const node = document.createElement("audio");
      node.setAttribute("data-fx-chain", JSON.stringify(carved));
      node.setAttribute("data-automation", lane);
      document.body.append(node);
      return node;
    };
    const settle = async () => {
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    };

    it("schedules the carve's envelopes once the processors land", async () => {
      const original = (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode;
      (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode = WorkletNodeStub;
      try {
        const worklets = new WorkletCtx();
        const src = new Node();
        const dst = new Node();
        const node = audioEl();
        attachElementFxChain(
          worklets as unknown as BaseAudioContext,
          node,
          src as never,
          dst as never,
          {
            scheduledAt: 0,
            elapsed: 0,
            rate: 1,
          },
        );
        // Dry to begin with, which is the whole reason for this path.
        expect(src.connections).toContain(dst);
        await settle();
        // Now routed through the chain — and the envelope is playing, which is
        // what "the carve still works" means.
        expect(src.connections.at(-1)).not.toBe(dst);
        const filter = worklets.biquads[0];
        expect(filter, "the carve's filter was never built").toBeTruthy();
        expect(filter!.gain.scheduled).toBe(true);
      } finally {
        (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode = original;
      }
    });

    it("keeps the carve alive when a compressor is added to a playing track", async () => {
      // The reported case, and the worse of the two paths: adding a worklet effect
      // to an already-attached chain rebuilt it, the build threw because nothing
      // on that path had registered the module, and the catch wired the source
      // straight to its gain — dropping the carve's filters along with the
      // compressor. Both symptoms, one cause.
      const original = (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode;
      (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode = WorkletNodeStub;
      try {
        const worklets = new WorkletCtx();
        const src = new Node();
        const dst = new Node();
        // Starts with the carve only: no worklets, so it attaches immediately.
        const node = document.createElement("audio");
        node.setAttribute(
          "data-fx-chain",
          JSON.stringify({
            version: 1,
            nodes: [
              {
                type: "peaking",
                id: "n1",
                fromCarve: true,
                params: { frequency: 1000, gain: -6, q: 1.4 },
              },
            ],
          }),
        );
        node.setAttribute("data-automation", lane);
        document.body.append(node);
        attachElementFxChain(
          worklets as unknown as BaseAudioContext,
          node,
          src as never,
          dst as never,
          { scheduledAt: 0, elapsed: 0, rate: 1 },
        );
        expect(worklets.biquads[0]!.gain.scheduled).toBe(true);

        // Now add the compressor, as the panel's "Add effect" does.
        node.setAttribute("data-fx-chain", JSON.stringify(carved));
        await settle();

        // Still routed through a chain rather than dry, the carve's filter rebuilt,
        // and its envelope scheduled onto the new one.
        expect(src.connections.at(-1)).not.toBe(dst);
        const rebuilt = worklets.biquads.at(-1)!;
        expect(rebuilt.gain.scheduled).toBe(true);
      } finally {
        (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode = original;
      }
    });

    it("follows the attribute after the late build, as any other chain does", async () => {
      const original = (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode;
      (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode = WorkletNodeStub;
      try {
        const worklets = new WorkletCtx() as unknown as BaseAudioContext;
        const src = new Node();
        const dst = new Node();
        const node = audioEl();
        attachElementFxChain(worklets, node, src as never, dst as never, {
          scheduledAt: 0,
          elapsed: 0,
          rate: 1,
        });
        await settle();
        const before = src.connections.at(-1);
        node.setAttribute(
          "data-fx-chain",
          JSON.stringify({
            version: 1,
            nodes: [{ type: "lowpass", id: "n9", params: { frequency: 900, q: 1, poles: "2" } }],
          }),
        );
        await settle();
        expect(src.connections.at(-1)).not.toBe(before);
      } finally {
        (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode = original;
      }
    });
  });

  /**
   * Every effect in the registry, one at a time.
   *
   * The limiter/compressor bug was not really about worklets: it was a build that
   * threw inside `attach`, whose catch wires the source straight to its gain —
   * dropping every other effect in the chain, the carve's filters included. Any
   * effect whose construction can fail has the same shape, so this asserts the two
   * things that were broken for all fourteen: the chain reaches the signal path,
   * and an envelope on it gets scheduled.
   */
  describe("every registry effect, in the signal path", () => {
    class RecordingParam {
      scheduled = false;
      value = 0;
      setValueAtTime(): void {
        this.scheduled = true;
      }
      linearRampToValueAtTime(): void {
        this.scheduled = true;
      }
      setValueCurveAtTime(): void {
        this.scheduled = true;
      }
      cancelScheduledValues(): void {}
      cancelAndHoldAtTime(): void {}
    }
    class RecordingNode extends Node {
      override frequency = new RecordingParam() as unknown as { value: number };
      override Q = new RecordingParam() as unknown as { value: number };
      override gain = new RecordingParam() as unknown as { value: number };
      override delayTime = new RecordingParam() as unknown as { value: number };
      // A modulated effect's `speed` lane drives its LFO's rate, which is where a
      // looping buffer keeps the frequency an oscillator kept on `frequency`.
      override playbackRate = new RecordingParam() as unknown as { value: number };
      port = { postMessage: () => {} };
    }
    class RichCtx extends Ctx {
      currentTime = 0;
      workletsReady = false;
      made: RecordingNode[] = [];
      audioWorklet = {
        addModule: async () => {
          this.workletsReady = true;
        },
      };
      private make(): Node {
        const node = new RecordingNode("node");
        this.made.push(node);
        return node as unknown as Node;
      }
      override createGain() {
        return this.make();
      }
      override createBiquadFilter() {
        return this.make();
      }
      override createIIRFilter() {
        return this.make();
      }
      override createDelay() {
        return this.make();
      }
      override createOscillator() {
        return this.make();
      }
      override createBufferSource() {
        return this.make();
      }
      override createWaveShaper() {
        return this.make();
      }
      override createConvolver() {
        return this.make();
      }
    }
    class WorkletNode extends RecordingNode {
      constructor(ctx: { workletsReady?: boolean }, name: string) {
        super("worklet");
        if (!ctx.workletsReady) {
          throw new Error(`AudioWorkletNode: processor "${name}" is not registered`);
        }
      }
    }
    const settle = async () => {
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    };

    for (const def of HF_AUDIO_FX) {
      const automatable = def.params.find((p) => p.kind === "number" && p.automatable);

      it(`routes ${def.id} and plays its envelope`, async () => {
        const original = (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode;
        (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode = WorkletNode;
        try {
          const ctxRich = new RichCtx();
          const src = new Node();
          const dst = new Node();
          const node = document.createElement("audio");
          node.setAttribute(
            "data-fx-chain",
            JSON.stringify({
              version: 1,
              nodes: [{ type: def.id, id: "n1", params: defaultAudioFxParams(def.id) }],
            }),
          );
          if (automatable && automatable.kind === "number") {
            node.setAttribute(
              "data-automation",
              JSON.stringify({
                version: 1,
                lanes: [
                  {
                    target: `fx.n1.${automatable.key}`,
                    points: [
                      { t: 0, v: automatable.default },
                      { t: 4, v: automatable.max },
                    ],
                  },
                ],
              }),
            );
          }
          document.body.append(node);
          attachElementFxChain(
            ctxRich as unknown as BaseAudioContext,
            node,
            src as never,
            dst as never,
            { scheduledAt: 0, elapsed: 0, rate: 1 },
          );
          await settle();

          // Not dry: the effect is between the source and its gain.
          expect(src.connections.at(-1), `${def.id} was left out of the path`).not.toBe(dst);
          if (automatable) {
            const scheduled = ctxRich.made.some((n) =>
              [n.frequency, n.Q, n.gain, n.delayTime, n.playbackRate].some(
                (p) => (p as unknown as RecordingParam).scheduled,
              ),
            );
            // A worklet exposes no AudioParams, so a lane on one has nowhere to
            // write — that is by design and the scheduler skips it.
            if (!def.web.startsWith("worklet-")) {
              expect(scheduled, `${def.id}'s envelope was never scheduled`).toBe(true);
            }
          }
        } finally {
          (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode = original;
        }
      });
    }
  });
});
