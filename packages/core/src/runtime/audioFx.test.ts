// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { attachElementFxChain } from "./audioFx.js";

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
  start(): void {}
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
    const handle = attachElementFxChain(ctx(), el(), src as never, dst as never);
    expect(handle).toBeNull();
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
      { getAttribute: () => "{not json" },
      src as never,
      dst as never,
    );
    expect(handle).toBeNull();
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
    expect(handle).toBeNull();
    expect(src.connections).toContain(dst);
  });

  it("tears the chain down on dispose", () => {
    const src = new Node();
    const dst = new Node();
    const handle = attachElementFxChain(ctx(), el(CHAIN), src as never, dst as never);
    handle!.dispose();
    expect((src.connections[0] as Node).disconnected).toBe(true);
  });
});
