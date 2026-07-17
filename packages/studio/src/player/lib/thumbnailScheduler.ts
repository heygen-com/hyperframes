import { TIMELINE_VIEWPORT_BUDGETS, type TimelineViewportBudgets } from "./timelineViewportBudgets";

export type ThumbnailPriority = "overscan" | "visible" | "interaction";
export type ThumbnailJobKind = "video" | "image" | "composition" | "waveform";

export type ThumbnailValue =
  | { kind: "image"; url: string; aspect: number }
  | { kind: "filmstrip"; urls: readonly string[]; aspect: number }
  | { kind: "waveform"; peaks: readonly number[] };

export interface ThumbnailLoadedResult {
  value: ThumbnailValue;
  /** Estimated decoded/object-URL bytes retained by this result. */
  weight: number;
  dispose?: () => void;
}

export interface ThumbnailRequest {
  key: string;
  projectId: string;
  sessionEpoch: number;
  kind: ThumbnailJobKind;
  priority: ThumbnailPriority;
  /** Rich work is paused while the timeline is fast-scrolling. */
  rich?: boolean;
  load: (signal: AbortSignal) => Promise<ThumbnailLoadedResult>;
}

export type ThumbnailSnapshot =
  | { status: "idle" | "queued" | "loading" }
  | { status: "ready"; value: ThumbnailValue }
  | { status: "error"; error: Error };

export interface ThumbnailLease {
  updatePriority(priority: ThumbnailPriority): void;
  release(): void;
}

export interface ThumbnailSchedulerDiagnostics {
  queued: number;
  active: number;
  leases: number;
  cacheEntries: number;
  cacheBytes: number;
  waveformCacheEntries: number;
  waveformCacheBytes: number;
  activeByKind: Readonly<Record<ThumbnailJobKind, number>>;
}

type EntryState = "queued" | "loading" | "ready" | "error";

interface ThumbnailEntry {
  request: ThumbnailRequest;
  scopedKey: string;
  state: EntryState;
  leases: Map<number, ThumbnailPriority>;
  listeners: Map<number, () => void>;
  controller: AbortController | null;
  value?: ThumbnailValue;
  error?: Error;
  failedAt?: number;
  weight: number;
  dispose?: () => void;
  disposed: boolean;
  cached: boolean;
  lastAccess: number;
  snapshot: ThumbnailSnapshot;
}

const PRIORITY_SCORE: Readonly<Record<ThumbnailPriority, number>> = {
  overscan: 0,
  visible: 1,
  interaction: 2,
};

const EMPTY_SNAPSHOT: ThumbnailSnapshot = Object.freeze({ status: "idle" });

function concurrencyBucket(kind: ThumbnailJobKind): "video" | "composition" | "general" {
  if (kind === "video") return "video";
  if (kind === "composition") return "composition";
  return "general";
}

function errorFrom(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

export function createThumbnailKey(parts: Readonly<Record<string, string | number | undefined>>) {
  return Object.entries(parts)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

/** Sole client owner for thumbnail work, cached resources, and cleanup. */
export class ThumbnailScheduler {
  private readonly entries = new Map<string, ThumbnailEntry>();
  private readonly budgets: Readonly<TimelineViewportBudgets>;
  private nextLeaseId = 1;
  private nextSequence = 1;
  private scrolling = false;
  private cacheBytes = 0;
  private waveformCacheBytes = 0;
  private readonly activeByBucket = { video: 0, composition: 0, general: 0 };
  private readonly activeByKind: Record<ThumbnailJobKind, number> = {
    video: 0,
    image: 0,
    composition: 0,
    waveform: 0,
  };
  private readonly now: () => number;

  constructor(
    budgets: Readonly<TimelineViewportBudgets> = TIMELINE_VIEWPORT_BUDGETS,
    now: () => number = Date.now,
  ) {
    this.budgets = budgets;
    this.now = now;
  }

  acquire(request: ThumbnailRequest, listener: () => void): ThumbnailLease {
    const scopedKey = this.scopedKey(request);
    let entry = this.entries.get(scopedKey);
    if (
      entry?.state === "error" &&
      entry.failedAt !== undefined &&
      this.now() - entry.failedAt >= this.budgets.metadataFailureTtlMs
    ) {
      this.deleteEntry(scopedKey, entry);
      entry = undefined;
    }
    if (!entry) {
      entry = {
        request,
        scopedKey,
        state: "queued",
        leases: new Map(),
        listeners: new Map(),
        controller: null,
        weight: 0,
        disposed: false,
        cached: false,
        lastAccess: this.nextSequence++,
        snapshot: Object.freeze({ status: "queued" }),
      };
      this.entries.set(scopedKey, entry);
    } else if (
      entry.request.kind !== request.kind ||
      Boolean(entry.request.rich) !== Boolean(request.rich)
    ) {
      throw new Error(`Thumbnail key collision for ${request.key}`);
    }

    const leaseId = this.nextLeaseId++;
    entry.leases.set(leaseId, request.priority);
    entry.listeners.set(leaseId, listener);
    entry.lastAccess = this.nextSequence++;
    this.pump();

    let released = false;
    return {
      updatePriority: (priority) => {
        const current = this.entries.get(scopedKey);
        if (!current || !current.leases.has(leaseId)) return;
        current.leases.set(leaseId, priority);
        current.lastAccess = this.nextSequence++;
        this.pump();
      },
      release: () => {
        if (released) return;
        released = true;
        const current = this.entries.get(scopedKey);
        if (!current) return;
        current.leases.delete(leaseId);
        current.listeners.delete(leaseId);
        if (current.leases.size === 0) {
          if (current.state === "queued") {
            this.deleteEntry(scopedKey, current);
          } else if (current.state === "loading") {
            current.controller?.abort();
            this.deleteEntry(scopedKey, current);
          } else if (current.state === "ready" && !current.cached) {
            this.deleteEntry(scopedKey, current);
          }
        }
        this.evict();
      },
    };
  }

  getSnapshot(
    request: Pick<ThumbnailRequest, "key" | "projectId" | "sessionEpoch">,
  ): ThumbnailSnapshot {
    const entry = this.entries.get(this.scopedKey(request));
    if (!entry) return EMPTY_SNAPSHOT;
    return entry.snapshot;
  }

  setScrolling(scrolling: boolean): void {
    if (this.scrolling === scrolling) return;
    this.scrolling = scrolling;
    if (!scrolling) this.pump();
  }

  invalidateProject(projectId: string): void {
    for (const [key, entry] of this.entries) {
      if (entry.request.projectId !== projectId) continue;
      entry.controller?.abort();
      this.deleteEntry(key, entry);
    }
  }

  clear(): void {
    for (const [key, entry] of this.entries) {
      entry.controller?.abort();
      this.deleteEntry(key, entry);
    }
  }

  getDiagnostics(): ThumbnailSchedulerDiagnostics {
    let queued = 0;
    let active = 0;
    let leases = 0;
    let cacheEntries = 0;
    let waveformCacheEntries = 0;
    for (const entry of this.entries.values()) {
      if (entry.state === "queued") queued++;
      if (entry.state === "loading") active++;
      if (entry.cached) {
        if (entry.request.kind === "waveform") waveformCacheEntries++;
        else cacheEntries++;
      }
      leases += entry.leases.size;
    }
    return {
      queued,
      active,
      leases,
      cacheEntries,
      cacheBytes: this.cacheBytes,
      waveformCacheEntries,
      waveformCacheBytes: this.waveformCacheBytes,
      activeByKind: { ...this.activeByKind },
    };
  }

  private pump(): void {
    const queued = Array.from(this.entries.values())
      .filter((entry) => entry.state === "queued" && entry.leases.size > 0)
      .sort((left, right) => {
        const priorityDelta = this.entryPriority(right) - this.entryPriority(left);
        return priorityDelta || left.lastAccess - right.lastAccess;
      });

    for (const entry of queued) {
      if (this.scrolling && entry.request.rich) continue;
      const bucket = concurrencyBucket(entry.request.kind);
      if (this.activeByBucket[bucket] >= this.bucketLimit(bucket)) continue;
      this.start(entry, bucket);
    }
  }

  private start(entry: ThumbnailEntry, bucket: "video" | "composition" | "general"): void {
    entry.state = "loading";
    entry.snapshot = Object.freeze({ status: "loading" });
    const controller = new AbortController();
    entry.controller = controller;
    this.activeByBucket[bucket]++;
    this.activeByKind[entry.request.kind]++;
    this.notify(entry);

    let pending: Promise<ThumbnailLoadedResult>;
    try {
      pending = entry.request.load(controller.signal);
    } catch (reason) {
      pending = Promise.reject(reason);
    }
    void pending
      .then((result) => {
        if (controller.signal.aborted || this.entries.get(entry.scopedKey) !== entry) {
          this.safeDispose(result.dispose);
          return;
        }
        if (!Number.isFinite(result.weight) || result.weight < 0) {
          this.safeDispose(result.dispose);
          throw new RangeError("Thumbnail result weight must be finite and non-negative");
        }
        entry.state = "ready";
        entry.value = result.value;
        entry.weight = Math.max(0, result.weight);
        entry.dispose = result.dispose;
        const isWaveform = entry.request.kind === "waveform";
        const cacheBudget = isWaveform
          ? this.budgets.waveformCacheBytes
          : this.budgets.thumbnailCacheBytes;
        entry.cached = entry.weight <= cacheBudget;
        if (entry.cached) {
          if (isWaveform) this.waveformCacheBytes += entry.weight;
          else this.cacheBytes += entry.weight;
        }
        entry.snapshot = Object.freeze({ status: "ready", value: result.value });
        this.notify(entry);
        this.evict();
        if (!entry.cached && entry.leases.size === 0) this.deleteEntry(entry.scopedKey, entry);
      })
      .catch((reason: unknown) => {
        if (this.entries.get(entry.scopedKey) !== entry) return;
        if (controller.signal.aborted && entry.leases.size === 0) {
          this.deleteEntry(entry.scopedKey, entry);
          return;
        }
        entry.state = "error";
        entry.error = errorFrom(reason);
        entry.failedAt = this.now();
        entry.snapshot = Object.freeze({ status: "error", error: entry.error });
        this.notify(entry);
        this.evictFailures();
      })
      .finally(() => {
        if (entry.controller === controller) entry.controller = null;
        this.activeByBucket[bucket]--;
        this.activeByKind[entry.request.kind]--;
        this.pump();
      });
  }

  private entryPriority(entry: ThumbnailEntry): number {
    let score = -1;
    for (const priority of entry.leases.values()) {
      score = Math.max(score, PRIORITY_SCORE[priority]);
    }
    return score;
  }

  private bucketLimit(bucket: "video" | "composition" | "general"): number {
    if (bucket === "video") return this.budgets.concurrentVideoDecodes;
    if (bucket === "composition") return this.budgets.concurrentCompositionFetches;
    return this.budgets.concurrentMetadataJobs;
  }

  private evict(): void {
    this.evictPartition(false);
    this.evictPartition(true);
  }

  private evictPartition(waveform: boolean): void {
    const cached = Array.from(this.entries.values()).filter(
      (entry) => entry.cached && (entry.request.kind === "waveform") === waveform,
    );
    const perProject = new Map<string, number>();
    for (const entry of cached) {
      perProject.set(entry.request.projectId, (perProject.get(entry.request.projectId) ?? 0) + 1);
    }
    cached.sort((left, right) => left.lastAccess - right.lastAccess);

    let cacheEntries = cached.length;
    for (const entry of cached) {
      const projectEntries = perProject.get(entry.request.projectId) ?? 0;
      const overBudget =
        cacheEntries >
          (waveform ? this.budgets.waveformCacheEntries : this.budgets.thumbnailCacheEntries) ||
        (waveform ? this.waveformCacheBytes : this.cacheBytes) >
          (waveform ? this.budgets.waveformCacheBytes : this.budgets.thumbnailCacheBytes) ||
        (!waveform && projectEntries > this.budgets.thumbnailCacheEntriesPerProject);
      if (!overBudget) continue;
      entry.cached = false;
      if (waveform) this.waveformCacheBytes -= entry.weight;
      else this.cacheBytes -= entry.weight;
      cacheEntries--;
      perProject.set(entry.request.projectId, projectEntries - 1);
      if (entry.leases.size === 0) this.deleteEntry(entry.scopedKey, entry);
    }
  }

  private notify(entry: ThumbnailEntry): void {
    for (const listener of new Set(entry.listeners.values())) listener();
  }

  private deleteEntry(key: string, entry: ThumbnailEntry): void {
    if (this.entries.get(key) !== entry) return;
    entry.snapshot = EMPTY_SNAPSHOT;
    this.notify(entry);
    this.entries.delete(key);
    if (entry.cached) {
      entry.cached = false;
      if (entry.request.kind === "waveform") this.waveformCacheBytes -= entry.weight;
      else this.cacheBytes -= entry.weight;
    }
    if (!entry.disposed) {
      entry.disposed = true;
      this.safeDispose(entry.dispose);
    }
    entry.listeners.clear();
    entry.leases.clear();
  }

  private evictFailures(): void {
    const failed = Array.from(this.entries.values())
      .filter((entry) => entry.state === "error" && entry.leases.size === 0)
      .sort((left, right) => left.lastAccess - right.lastAccess);
    const overflow = failed.length - this.budgets.thumbnailCacheEntries;
    for (const entry of failed.slice(0, Math.max(0, overflow))) {
      this.deleteEntry(entry.scopedKey, entry);
    }
  }

  private safeDispose(dispose: (() => void) | undefined): void {
    try {
      dispose?.();
    } catch {
      // Cleanup is best-effort; one broken resource must not block the remaining cleanup.
    }
  }

  private scopedKey(request: Pick<ThumbnailRequest, "key" | "projectId" | "sessionEpoch">) {
    return createThumbnailKey({
      project: request.projectId,
      session: request.sessionEpoch,
      request: request.key,
    });
  }
}

export const thumbnailScheduler = new ThumbnailScheduler();
