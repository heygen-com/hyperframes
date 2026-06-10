import type { PersistAdapter, PersistVersionEntry } from "./types.js";
import type { PersistErrorEvent } from "../types.js";

class MemoryAdapter implements PersistAdapter {
  private readonly store = new Map<string, string>();
  private readonly history = new Map<string, PersistVersionEntry[]>();
  private readonly errorListeners: Array<(e: PersistErrorEvent) => void> = [];
  private versionCounter = 0;
  private faultMessage: string | null = null;

  async read(path: string): Promise<string | undefined> {
    return this.store.get(path);
  }

  async write(path: string, content: string): Promise<void> {
    if (this.faultMessage !== null) {
      const msg = this.faultMessage;
      this.faultMessage = null;
      this.errorListeners.forEach((l) => l({ error: { message: msg } }));
      return;
    }
    this.store.set(path, content);
    const hist = this.history.get(path) ?? [];
    const entry: PersistVersionEntry = {
      key: `v${++this.versionCounter}`,
      content,
    };
    hist.unshift(entry);
    this.history.set(path, hist);
  }

  async flush(): Promise<void> {
    // Memory adapter writes are synchronous — nothing to drain.
  }

  async listVersions(path: string): Promise<PersistVersionEntry[]> {
    return [...(this.history.get(path) ?? [])];
  }

  async loadFrom(path: string, versionKey: string): Promise<string | undefined> {
    const hist = this.history.get(path) ?? [];
    return hist.find((v) => v.key === versionKey)?.content;
  }

  on(event: "persist:error", handler: (e: PersistErrorEvent) => void): () => void {
    if (event !== "persist:error") return () => {};
    this.errorListeners.push(handler);
    return () => {
      const idx = this.errorListeners.indexOf(handler);
      if (idx !== -1) this.errorListeners.splice(idx, 1);
    };
  }

  /** Test helper — next write fires persist:error instead of committing */
  injectFault(message: string): void {
    this.faultMessage = message;
  }
}

export function createMemoryAdapter(): PersistAdapter & { injectFault(message: string): void } {
  return new MemoryAdapter();
}
