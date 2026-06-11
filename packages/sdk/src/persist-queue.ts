/**
 * Optional persist queue module (F5 layering).
 *
 * Subscribes to 'change' events and schedules async writes via a PersistAdapter.
 * One in-flight write at a time; latest state always wins (last-write-wins coalescing).
 *
 * Wired automatically by openComposition() in standalone (T1/T2) mode.
 * T3 (embedded) hosts own persistence — do not use this module.
 */

import type { Composition, PersistErrorEvent } from "./types.js";
import type { PersistAdapter } from "./adapters/types.js";

export interface PersistQueueModule {
  /** Force an immediate write (e.g. before app close). */
  flush(): Promise<void>;
  dispose(): void;
}

export interface PersistQueueOptions {
  /** Adapter path to write to. Default: "composition.html" */
  path?: string;
  /** Called when adapter.write() rejects. */
  onError?: (e: PersistErrorEvent) => void;
}

export function createPersistQueue(
  session: Composition,
  adapter: PersistAdapter,
  opts: PersistQueueOptions = {},
): PersistQueueModule {
  const path = opts.path ?? "composition.html";
  let pendingWrite: ReturnType<typeof setTimeout> | null = null;
  // Promise-chain mutex: each write chains onto the prior, preventing concurrent writes.
  let writeChain: Promise<void> = Promise.resolve();
  let disposed = false;

  function scheduleWrite(): void {
    if (pendingWrite !== null) clearTimeout(pendingWrite);
    pendingWrite = setTimeout(() => {
      pendingWrite = null;
      void doWrite();
    }, 0);
  }

  function doWrite(): Promise<void> {
    if (disposed) return Promise.resolve();
    const content = session.serialize();
    writeChain = writeChain.then(async () => {
      if (disposed) return;
      try {
        await adapter.write(path, content);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        opts.onError?.({ error: { message, cause: err } });
      }
    });
    return writeChain;
  }

  const unsubscribe = session.on("change", () => {
    scheduleWrite();
  });

  return {
    async flush(): Promise<void> {
      if (pendingWrite !== null) {
        clearTimeout(pendingWrite);
        pendingWrite = null;
      }
      await doWrite();
    },

    dispose(): void {
      disposed = true;
      if (pendingWrite !== null) {
        clearTimeout(pendingWrite);
        pendingWrite = null;
      }
      unsubscribe();
    },
  };
}
