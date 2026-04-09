/**
 * Simple async semaphore for limiting concurrent operations.
 */
export class Semaphore {
  private queue: Array<() => void> = [];
  private active = 0;

  constructor(private readonly maxConcurrent: number) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.maxConcurrent) {
      this.active++;
      return () => this.release();
    }

    return new Promise<() => void>((resolve) => {
      this.queue.push(() => {
        this.active++;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }

  /** Current number of active slots. */
  get activeCount(): number {
    return this.active;
  }

  /** Number of waiters in the queue. */
  get waitingCount(): number {
    return this.queue.length;
  }
}
