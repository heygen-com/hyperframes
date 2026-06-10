import type { PersistAdapter, PersistVersionEntry } from "./types.js";
import type { PersistErrorEvent } from "../types.js";

export interface FsAdapterOptions {
  /** Root directory for composition files */
  root: string;
}

// Phase 4 — fs adapter stub. Full implementation in SDK Phase 4 (adapters stage).
// Uses Node.js fs/promises; not browser-safe (must be conditionally imported by consumers).

class FsAdapter implements PersistAdapter {
  private readonly root: string;

  constructor(opts: FsAdapterOptions) {
    this.root = opts.root;
  }

  async read(_path: string): Promise<string | undefined> {
    throw new Error("FsAdapter: Phase 4 — not yet implemented");
  }

  async write(_path: string, _content: string): Promise<void> {
    throw new Error("FsAdapter: Phase 4 — not yet implemented");
  }

  async flush(): Promise<void> {
    throw new Error("FsAdapter: Phase 4 — not yet implemented");
  }

  async listVersions(_path: string): Promise<PersistVersionEntry[]> {
    throw new Error("FsAdapter: Phase 4 — not yet implemented");
  }

  async loadFrom(_path: string, _versionKey: string): Promise<string | undefined> {
    throw new Error("FsAdapter: Phase 4 — not yet implemented");
  }

  on(_event: "persist:error", _handler: (e: PersistErrorEvent) => void): () => void {
    return () => {};
  }
}

export function createFsAdapter(opts: FsAdapterOptions): PersistAdapter {
  return new FsAdapter(opts);
}
