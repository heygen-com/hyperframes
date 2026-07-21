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
  private readonly activeEntries = new Set<GenerationEntry>();
  private active = 0;

  constructor(private readonly concurrency = 1) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new RangeError("Thumbnail concurrency must be a positive integer");
    }
  }

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
        leases: 0,
        state: "queued",
        work,
        promise,
        resolve,
        reject,
      };
      this.entries.set(key, entry);
      this.queue.push(entry);
    }
    entry.leases++;
    this.pump();

    return this.lease(entry, signal);
  }

  protectedKeys(): ReadonlySet<string> {
    return new Set([...this.entries.keys(), ...[...this.activeEntries].map((entry) => entry.key)]);
  }

  private lease(entry: GenerationEntry, signal: AbortSignal): Promise<ThumbnailGenerationValue> {
    return new Promise((resolve, reject) => {
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        signal.removeEventListener("abort", onAbort);
        entry.leases--;
        if (entry.leases > 0 || !this.entries.has(entry.key)) return;

        entry.controller.abort();
        if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
        if (entry.state === "queued") {
          const index = this.queue.indexOf(entry);
          if (index >= 0) this.queue.splice(index, 1);
          entry.reject(new DOMException("Aborted", "AbortError"));
        }
      };
      const onAbort = () => {
        release();
        reject(new DOMException("Aborted", "AbortError"));
      };

      signal.addEventListener("abort", onAbort, { once: true });
      entry.promise.then(
        (value) => {
          release();
          resolve(value);
        },
        (reason) => {
          release();
          reject(reason);
        },
      );
    });
  }

  private pump(): void {
    while (this.active < this.concurrency) {
      const entry = this.queue.shift();
      if (!entry) return;
      if (entry.leases === 0) continue;
      entry.state = "active";
      this.activeEntries.add(entry);
      this.active++;
      void this.run(entry);
    }
  }

  private async run(entry: GenerationEntry): Promise<void> {
    try {
      entry.resolve(await entry.work(entry.controller.signal));
    } catch (error) {
      entry.reject(error);
    } finally {
      this.active--;
      this.activeEntries.delete(entry);
      if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
      this.pump();
    }
  }
}

export const thumbnailGenerationCoordinator = new ThumbnailGenerationCoordinator(1);
