/**
 * Simple async semaphore for limiting concurrent operations.
 */
export declare class Semaphore {
    private readonly maxConcurrent;
    private queue;
    private active;
    constructor(maxConcurrent: number);
    acquire(): Promise<() => void>;
    private release;
    /** Current number of active slots. */
    get activeCount(): number;
    /** Number of waiters in the queue. */
    get waitingCount(): number;
}
//# sourceMappingURL=semaphore.d.ts.map