import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { replaceFileAtomically } from "../helpers/atomicFile.js";
import { affectsProjectSignature, listProjectFiles } from "../helpers/projectSignature.js";
import { openBlobStore, type BlobStore } from "./blobStore.js";
import { projectHistoryId } from "./historyId.js";
import {
  START,
  appendRecord,
  foldOldest,
  manifestAt,
  readLog,
  referencedHashes,
  stepTarget,
  undoneIds,
  writeLog,
  type HistoryEntry,
  type HistoryFileChange,
  type HistoryLog,
  type HistoryWho,
  type Manifest,
} from "./historyLog.js";

export interface ProjectHistoryOptions {
  projectDir: string;
  /** Kept outside the project, so nothing tidying the project can take its history with it. */
  historyRoot: string;
  now?: () => number;
  /** Writes with no window open group into one entry until this long without another (default 2 s)... */
  quietMs?: number;
  /** ...or this long after the first (default 30 s). */
  maxGroupMs?: number;
  /** Past this many stored bytes the oldest unpinned entries are folded away (default 2 GB). */
  budgetBytes?: number;
  /** A sweep or commit that a watcher or timer started failed. */
  onError?: (error: unknown) => void;
}

export interface HistoryListItem extends HistoryEntry {
  pinned: boolean;
  undone: boolean;
}

export type HistoryResult =
  | { ok: true; entry: HistoryEntry | null }
  | { ok: false; conflict: { files: string[]; newer: string[] } };

export interface HistoryWindow {
  readonly id: string;
  /** Records everything written since the window opened as one entry; null when nothing changed. */
  close(): Promise<HistoryEntry | null>;
}

export interface ProjectHistory {
  readonly projectId: string;
  /** Writes until close() are this writer's, as one entry. ponytail: overlapping windows give a write to the newest. */
  beginWindow(who: HistoryWho, label: string): Promise<HistoryWindow>;
  /** A watcher saw `path` change (project-relative or absolute). */
  noteChange(path: string): void;
  list(): HistoryListItem[];
  /** Cmd+Z (back) and Cmd+Shift+Z (forward), whoever made the change. */
  step(direction: "back" | "forward", who: HistoryWho): Promise<HistoryResult>;
  /** A conflict (a file changed since) returns the choice; pass `mode` to take one. */
  undo(
    id: string,
    options: { who: HistoryWho; mode?: "just-this" | "back-to-before" },
  ): Promise<HistoryResult>;
  /** Makes the files equal what they were right after `point` (an entry id, or START). */
  restore(point: string, who: HistoryWho): Promise<HistoryEntry | null>;
  /** The files at `point` without writing anything: path to hash, read through readBlob. */
  peek(point: string): Record<string, string> | null;
  readBlob(hash: string): Promise<Buffer>;
  pin(id: string, pinned: boolean): void;
  onEntry(listener: (entry: HistoryEntry) => void): () => void;
  /** Takes in every pending write and closes the outside group. */
  flush(): Promise<void>;
  close(): Promise<void>;
}

const OUTSIDE: HistoryWho = { kind: "outside", name: "Outside" };
const OUTSIDE_LABEL = "Changed outside the app";

interface Tracked {
  hash: string;
  stat: string;
}

interface Group {
  id: string;
  who: HistoryWho;
  label: string;
  startedAt: number;
  changes: Map<string, HistoryFileChange>;
}

const statKey = (file: { size: number; mtimeMs: number; ctimeMs: number }) =>
  `${file.size}:${file.mtimeMs}:${file.ctimeMs}`;

class Engine {
  readonly dir: string;
  readonly home: string;
  log: HistoryLog = { baseline: new Map(), entries: [], pins: new Set() };
  tracked = new Map<string, Tracked>();
  windows: Group[] = [];
  outside: Group | null = null;
  quietTimer: NodeJS.Timeout | undefined;
  maxTimer: NodeJS.Timeout | undefined;
  notedTimer: NodeJS.Timeout | null = null;
  listeners = new Set<(entry: HistoryEntry) => void>();
  tail: Promise<unknown> = Promise.resolve();

  constructor(
    readonly options: ProjectHistoryOptions,
    readonly projectId: string,
    readonly blobs: BlobStore,
  ) {
    this.dir = resolve(options.projectDir);
    this.home = join(options.historyRoot, projectId);
  }

  get logFile() {
    return join(this.home, "log.jsonl");
  }

  now() {
    return (this.options.now ?? Date.now)();
  }

  /** One operation at a time, in order: sweeps, windows and undos never interleave. */
  queue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task);
    this.tail = run.catch(() => undefined);
    return run;
  }

  async start(): Promise<void> {
    const log = readLog(this.logFile);
    if (!log) return this.firstOpen();
    this.log = log;
    const cache = this.readStatCache();
    const last = this.log.entries.at(-1)?.id ?? START;
    for (const [path, hash] of manifestAt(this.log, last) ?? []) {
      const cached = cache.get(path);
      this.tracked.set(path, { hash, stat: cached?.hash === hash ? cached.stat : "" });
    }
    // What changed while the project was closed is one outside entry.
    await this.sweep();
    await this.commitOutside();
  }

  async firstOpen(): Promise<void> {
    for (const file of listProjectFiles(this.dir))
      this.tracked.set(file.path, {
        hash: await this.blobs.put(join(this.dir, file.path)),
        stat: statKey(file),
      });
    this.log.baseline = this.manifest();
    writeLog(this.logFile, this.log);
    this.saveStatCache();
  }

  manifest(): Manifest {
    return new Map([...this.tracked].map(([path, file]) => [path, file.hash]));
  }

  readStatCache(): Map<string, Tracked> {
    try {
      const files = JSON.parse(readFileSync(join(this.home, "stat.json"), "utf-8"));
      return new Map(Object.entries(files as Record<string, Tracked>));
    } catch {
      return new Map();
    }
  }

  saveStatCache(): void {
    const files = JSON.stringify(Object.fromEntries(this.tracked));
    replaceFileAtomically(join(this.home, "stat.json"), files, 0o644);
  }

  /**
   * Takes in every write since the last sweep and files each change to its writer. ponytail: always the whole
   * project (a stat per file, a hash only when the stat moved); per-path sweeps if projects reach tens of thousands.
   */
  async sweep(): Promise<void> {
    // A missing project folder was moved or removed, not emptied: that is no change to its files.
    if (!existsSync(this.dir)) return;
    const seen = listProjectFiles(this.dir);
    let changed = false;
    for (const file of seen) changed = (await this.observe(file.path, statKey(file))) || changed;
    const present = new Set(seen.map((file) => file.path));
    for (const [path, known] of this.tracked) {
      if (present.has(path)) continue;
      this.tracked.delete(path);
      this.record(path, known.hash, null);
      changed = true;
    }
    if (changed) this.saveStatCache();
  }

  async observe(path: string, stat: string): Promise<boolean> {
    const known = this.tracked.get(path);
    if (known?.stat === stat) return false;
    const hash = await this.blobs.put(join(this.dir, path)).catch((error) => {
      // Gone between the stat and the copy: the next sweep records the delete.
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    if (hash === null) return false;
    this.tracked.set(path, { hash, stat });
    if (known?.hash !== hash) this.record(path, known?.hash ?? null, hash);
    return true;
  }

  record(path: string, before: string | null, after: string | null): void {
    const group = this.windows.at(-1) ?? this.outsideGroup();
    const earlier = group.changes.get(path);
    const from = earlier ? earlier.before : before;
    if (from === after) group.changes.delete(path);
    else group.changes.set(path, { path, before: from, after });
  }

  outsideGroup(): Group {
    const { quietMs = 2000, maxGroupMs = 30_000 } = this.options;
    const closeIn = (ms: number) => {
      const timer = setTimeout(() => this.background(() => this.commitOutside()), ms);
      timer.unref?.();
      return timer;
    };
    if (!this.outside) {
      this.outside = this.newGroup(OUTSIDE, OUTSIDE_LABEL);
      this.maxTimer = closeIn(maxGroupMs);
    }
    clearTimeout(this.quietTimer);
    this.quietTimer = closeIn(quietMs);
    return this.outside;
  }

  newGroup(who: HistoryWho, label: string): Group {
    return { id: randomUUID(), who, label, startedAt: this.now(), changes: new Map() };
  }

  async commitOutside(): Promise<void> {
    clearTimeout(this.quietTimer);
    clearTimeout(this.maxTimer);
    const group = this.outside;
    this.outside = null;
    if (group) await this.commit(group);
  }

  async commit(group: Group, extra: Partial<HistoryEntry> = {}): Promise<HistoryEntry | null> {
    if (!group.changes.size) return null;
    const { changes, ...rest } = group;
    const files = [...changes.values()].sort((a, b) => a.path.localeCompare(b.path));
    const entry: HistoryEntry = { ...rest, endedAt: this.now(), files, ...extra };
    this.log.entries.push(entry);
    appendRecord(this.logFile, { type: "entry", entry });
    for (const listener of this.listeners) listener(entry);
    await this.keepWithinBudget();
    return entry;
  }

  /** Every hash a kept point or a still-open group can need. */
  inUse(): Set<string> {
    const keep = referencedHashes(this.log, this.manifest());
    for (const group of [...this.windows, ...(this.outside ? [this.outside] : [])])
      for (const file of group.changes.values()) if (file.before) keep.add(file.before);
    return keep;
  }

  async keepWithinBudget(): Promise<void> {
    const budget = this.options.budgetBytes ?? 2 * 1024 ** 3;
    let folded = false;
    while (this.blobs.bytes() > budget && foldOldest(this.log)) {
      folded = true;
      await this.blobs.prune(this.inUse());
    }
    if (folded) writeLog(this.logFile, this.log);
  }

  /** Before an operation: every write so far is filed, and the outside group is closed so it sorts first. */
  async settle(): Promise<void> {
    await this.sweep();
    await this.commitOutside();
  }

  /** A watcher saw a write: one sweep per burst takes it in (a deleted folder is reported by its name alone). */
  noteChange(path: string): void {
    if (this.notedTimer || !affectsProjectSignature(this.dir, resolve(this.dir, path))) return;
    this.notedTimer = setTimeout(() => {
      this.notedTimer = null;
      this.background(() => this.sweep());
    }, 20);
    this.notedTimer.unref?.();
  }

  background(task: () => Promise<unknown>): void {
    this.queue(task).catch((error) => this.options.onError?.(error));
  }

  beginWindow(who: HistoryWho, label: string): Promise<HistoryWindow> {
    return this.queue(async () => {
      // Writes before the window opened are not this writer's.
      await this.sweep();
      const group = this.newGroup(who, label);
      this.windows.push(group);
      return {
        id: group.id,
        close: () =>
          this.queue(async () => {
            await this.sweep();
            this.windows = this.windows.filter((open) => open !== group);
            return this.commit(group);
          }),
      };
    });
  }

  /** Writes `target` (path to hash, null deletes) as one entry of `who`'s. */
  async writeAs(
    who: HistoryWho,
    label: string,
    target: Map<string, string | null>,
    extra: Partial<HistoryEntry>,
  ): Promise<HistoryEntry | null> {
    const group = this.newGroup(who, label);
    this.windows.push(group);
    try {
      for (const [path, hash] of target) {
        if ((this.tracked.get(path)?.hash ?? null) === hash) continue;
        if (hash === null) await rm(join(this.dir, path), { force: true });
        else await this.blobs.writeTo(hash, join(this.dir, path));
      }
      await this.sweep();
    } finally {
      this.windows = this.windows.filter((open) => open !== group);
    }
    return this.commit(group, extra);
  }

  entry(id: string): HistoryEntry {
    const entry = this.log.entries.find((candidate) => candidate.id === id);
    if (!entry) throw new Error("That change is no longer kept in this project's history.");
    return entry;
  }

  undoLabel(entry: HistoryEntry): string {
    if (!entry.undoes) return `Undid: ${entry.label}`;
    const original = this.log.entries.find((candidate) => candidate.id === entry.undoes);
    return `Redid: ${original?.label ?? entry.label}`;
  }

  async undoNow(
    id: string,
    who: HistoryWho,
    mode?: "just-this" | "back-to-before",
  ): Promise<HistoryResult> {
    const entry = this.entry(id);
    const changed = entry.files.filter(
      (file) => (this.tracked.get(file.path)?.hash ?? null) !== file.after,
    );
    if (changed.length && !mode) return { ok: false, conflict: this.conflict(entry, changed) };
    if (mode === "back-to-before") {
      const index = this.log.entries.indexOf(entry);
      const point = index > 0 ? this.log.entries[index - 1]!.id : START;
      return {
        ok: true,
        entry: await this.restoreNow(point, who, `Went back to before: ${entry.label}`),
      };
    }
    const target = new Map(entry.files.map((file) => [file.path, file.before]));
    return {
      ok: true,
      entry: await this.writeAs(who, this.undoLabel(entry), target, { undoes: id }),
    };
  }

  conflict(entry: HistoryEntry, changed: HistoryFileChange[]) {
    const paths = new Set(changed.map((file) => file.path));
    const after = this.log.entries.slice(this.log.entries.indexOf(entry) + 1);
    const newer = after.filter((later) => later.files.some((file) => paths.has(file.path)));
    return { files: [...paths], newer: newer.map((later) => later.id) };
  }

  async restoreNow(point: string, who: HistoryWho, label: string): Promise<HistoryEntry | null> {
    const files = manifestAt(this.log, point);
    if (!files) throw new Error("That point is no longer kept in this project's history.");
    const target = new Map<string, string | null>(
      [...this.tracked.keys()].map((path) => [path, null]),
    );
    for (const [path, hash] of files) target.set(path, hash);
    return this.writeAs(who, label, target, { restoredTo: point });
  }

  pointLabel(point: string): string {
    return point === START ? "the start" : this.entry(point).label;
  }

  api(): ProjectHistory {
    return {
      projectId: this.projectId,
      beginWindow: (who, label) => this.beginWindow(who, label),
      noteChange: (path) => this.noteChange(path),
      list: () => {
        const undone = undoneIds(this.log.entries);
        return this.log.entries.map((entry) => ({
          ...entry,
          pinned: this.log.pins.has(entry.id),
          undone: undone.has(entry.id),
        }));
      },
      step: (direction, who) =>
        this.queue(async () => {
          await this.settle();
          const target = stepTarget(this.log.entries, direction);
          return target ? this.undoNow(target.id, who) : { ok: true, entry: null };
        }),
      undo: (id, { who, mode }) =>
        this.queue(async () => {
          await this.settle();
          return this.undoNow(id, who, mode);
        }),
      restore: (point, who) =>
        this.queue(async () => {
          await this.settle();
          return this.restoreNow(point, who, `Restored: ${this.pointLabel(point)}`);
        }),
      peek: (point) => {
        const files = manifestAt(this.log, point);
        return files && Object.fromEntries(files);
      },
      readBlob: (hash) => this.blobs.read(hash),
      pin: (id, pinned) => {
        this.entry(id);
        if (pinned) this.log.pins.add(id);
        else this.log.pins.delete(id);
        appendRecord(this.logFile, { type: "pin", id, pinned });
      },
      onEntry: (listener) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      },
      flush: () => this.queue(() => this.settle()),
      close: async () => {
        if (this.notedTimer) clearTimeout(this.notedTimer);
        await this.queue(() => this.settle());
      },
    };
  }
}

/** Opens a project's history: every write to its files becomes an entry that can be undone or restored. */
export async function openProjectHistory(options: ProjectHistoryOptions): Promise<ProjectHistory> {
  const projectId = projectHistoryId(options.projectDir, options.historyRoot);
  const blobs = await openBlobStore(join(options.historyRoot, projectId, "blobs"));
  const engine = new Engine(options, projectId, blobs);
  await engine.queue(() => engine.start());
  return engine.api();
}
