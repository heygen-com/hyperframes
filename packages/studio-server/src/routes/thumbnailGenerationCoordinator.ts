export type ThumbnailGenerationValue = Buffer | null;
export type ThumbnailGenerationWork = (signal: AbortSignal) => Promise<ThumbnailGenerationValue>;

interface GenerationEntry {
  key: string;
  controller: AbortController;
  leases: number;
  state: "queued" | "active";
  work: ThumbnailGenerationWork;
  promise: Promise<ThumbnailGenerationValue>;
  resolve: (value: ThumbnailGenerationValue) => void;
  reject: (reason: unknown) => void;
}

/** Sole server owner for same-key dedupe, concurrency, cancellation, and queue order. */
export class ThumbnailGenerationCoordinator {
  private readonly entries = new Map<string, GenerationEntry>();
  private readonly queue: GenerationEntry[] = [];
  private active = 0;

  constructor(private readonly concurrency = 1) {}

  acquire(
    key: string,
    signal: AbortSignal,
    work: ThumbnailGenerationWork,
  ): Promise<ThumbnailGenerationValue> {
    if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
    let entry = this.entries.get(key);
    if (!entry) {
      let resolve!: (value: ThumbnailGenerationValue) => void;
      let reject!: (reason: unknown) => void;
      const promise = new Promise<ThumbnailGenerationValue>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      entry = {
        key,
        controller: new AbortController(),
        leases: 1,
        state: "queued",
        work,
        promise,
        resolve,
        reject,
      };
      this.entries.set(key, entry);
      this.queue.push(entry);
      this.pump();
    } else {
      entry.leases++;
    }

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      entry!.leases--;
      if (entry!.leases > 0 || !this.entries.has(key)) return;
      entry!.controller.abort();
      if (entry!.state === "queued") {
        const index = this.queue.indexOf(entry!);
        if (index >= 0) this.queue.splice(index, 1);
        this.entries.delete(key);
        entry!.reject(new DOMException("Aborted", "AbortError"));
      }
    };

    return new Promise<ThumbnailGenerationValue>((resolve, reject) => {
      const onAbort = () => {
        release();
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      entry!.promise.then(resolve, reject).finally(() => {
        signal.removeEventListener("abort", onAbort);
        release();
      });
    });
  }

  protectedKeys(): ReadonlySet<string> {
    return new Set(this.entries.keys());
  }

  private pump(): void {
    while (this.active < this.concurrency) {
      const entry = this.queue.shift();
      if (!entry) return;
      if (entry.leases === 0) {
        this.entries.delete(entry.key);
        entry.reject(new DOMException("Aborted", "AbortError"));
        continue;
      }
      entry.state = "active";
      this.active++;
      void entry
        .work(entry.controller.signal)
        .then(entry.resolve, entry.reject)
        .finally(() => {
          this.active--;
          this.entries.delete(entry.key);
          this.pump();
        });
    }
  }
}

export const thumbnailGenerationCoordinator = new ThumbnailGenerationCoordinator(1);
