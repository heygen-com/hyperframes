/**
 * Vitest setup: install a minimal in-memory BroadcastChannel polyfill so that
 * happy-dom tests can exercise the presenter/audience channel code path.
 * This polyfill is intentionally NOT shipped in production code.
 */

type MsgHandler = (event: MessageEvent) => void;

const registry = new Map<string, Set<InMemoryBroadcastChannel>>();

class InMemoryBroadcastChannel {
  onmessage: MsgHandler | null = null;
  readonly name: string;
  private _closed = false;

  constructor(name: string) {
    this.name = name;
    let set = registry.get(name);
    if (!set) {
      set = new Set();
      registry.set(name, set);
    }
    set.add(this);
  }

  // fallow-ignore-next-line complexity
  postMessage(data: unknown): void {
    if (this._closed) return;
    const peers = registry.get(this.name);
    if (!peers) return;
    for (const peer of peers) {
      if (peer === this) continue;
      peer.onmessage?.(new MessageEvent("message", { data }));
    }
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    registry.get(this.name)?.delete(this);
  }
}

if (typeof globalThis.BroadcastChannel === "undefined") {
  (globalThis as Record<string, unknown>)["BroadcastChannel"] = InMemoryBroadcastChannel;
}
