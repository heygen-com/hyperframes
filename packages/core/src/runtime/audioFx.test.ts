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
      { getAttribute: () => "{not json" },
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

  it("tears the chain down on dispose", () => {
    const src = new Node();
    const dst = new Node();
    const handle = attachElementFxChain(ctx(), el(CHAIN), src as never, dst as never);
    handle!.dispose();
    expect((src.connections[0] as Node).disconnected).toBe(true);
  });
});
