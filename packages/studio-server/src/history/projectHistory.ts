import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { replaceFileAtomically } from "../helpers/atomicFile.js";
import {
  DELETED_VERSION,
  hashOfVersion,
  hashVersion,
  recordFileWriteReceipt,
} from "../helpers/fileVersion.js";
import { affectsProjectSignature, listProjectFiles } from "../helpers/projectSignature.js";
import { openBlobStore, type BlobStore } from "./blobStore.js";
import { projectHistoryId } from "./historyId.js";
import {
  START,
  foldOldest,
  manifestAt,
  readLog,
  saveRecord,
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

/** Where hosts keep project histories unless told otherwise: outside every project, so no tidy-up takes one away. */
export const DEFAULT_HISTORY_ROOT = join(homedir(), ".cache", "hyperframes", "history");

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

interface ClaimOptions {
  coalesceKey?: string;
  idleMs?: number;
  /** Per path, the version (fileContentVersion) the claimer overwrote: earlier changes stay their writer's. */
  overwrote?: Readonly<Record<string, string>>;
}

interface Writing {
  writeToken?: string;
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
  /** Records everything written since the window opened as one entry (null when nothing changed); after the window
   * ended by itself or by flush, returns the entry it became. */
  close(): Promise<HistoryEntry | null>;
}

export interface ProjectHistory {
  readonly projectId: string;
  /**
   * Writes until close() are this writer's, as one entry whose id is the window's. A window with no write for
   * `idleMs` (default maxGroupMs) ends by itself. ponytail: overlapping windows give a write to the newest.
   */
  beginWindow(
    who: HistoryWho,
    label: string,
    options?: { idleMs?: number },
  ): Promise<HistoryWindow>;
  /**
   * For a writer that records after writing (Studio): takes in every write so far and moves the not yet committed
   * changes to `paths`, filed outside or in another writer's open window, into one entry of `who`'s. With
   * `overwrote`, a change that began before the claimer's write keeps that earlier part as its writer's. Claims with
   * the same coalesceKey merge until a claim with another key, `idleMs` (default quietMs) without one, or any
   * operation. Null when nothing was claimed, or when a coalescing claim's writes net to nothing (a drag back to
   * where it started).
   */
  claim(
    who: HistoryWho,
    label: string,
    paths: readonly string[],
    options?: ClaimOptions,
  ): Promise<{ id: string } | null>;
  /** A watcher saw `path` change (project-relative or absolute). */
  noteChange(path: string): void;
  list(): HistoryListItem[];
  /**
   * Cmd+Z (back) and Cmd+Shift+Z (forward), whoever made the change. Operations given a `writeToken` label their
   * file writes with it, so the watcher's echo reads as the caller's own write.
   */
  step(direction: "back" | "forward", who: HistoryWho, options?: Writing): Promise<HistoryResult>;
  /** A conflict (a file changed since) returns the choice; pass `mode` to take one. */
  undo(
    id: string,
    options: { who: HistoryWho; mode?: "just-this" | "back-to-before" } & Writing,
  ): Promise<HistoryResult>;
  /** Makes the files equal what they were right after `point` (an entry id, or START). */
  restore(point: string, who: HistoryWho, options?: Writing): Promise<HistoryEntry | null>;
  /** The files at `point` without writing anything: path to hash, read through readBlob. */
  peek(point: string): Record<string, string> | null;
  readBlob(hash: string): Promise<Buffer>;
  pin(id: string, pinned: boolean): void;
  onEntry(listener: (entry: HistoryEntry) => void): () => void;
  /** Takes in every pending write and commits every open window and the outside group. */
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
  /** Windows only: the idle lifetime, its timer, and the entry it became once ended. */
  idleMs?: number;
  idleTimer?: NodeJS.Timeout;
  entry?: HistoryEntry | null;
}

/**
 * A stat is only trusted once the file is older than any file system's timestamp tick (git's "racily clean"): a
 * same-size rewrite inside one tick keeps its size, mtime and ctime. "" is never trusted, so the file is re-hashed.
 */
const RACY_MS = 2000;
const statKey = (file: { size: number; mtimeMs: number; ctimeMs: number }, sweptAt: number) =>
  sweptAt - Math.max(file.mtimeMs, file.ctimeMs) < RACY_MS
    ? ""
    : `${file.size}:${file.mtimeMs}:${file.ctimeMs}`;

const sameWho = (a: HistoryWho, b: HistoryWho) => a.kind === b.kind && a.name === b.name;

/**
 * Cuts a change at `at`, the content the claimer overwrote: what came before it stays [0], the rest is claimed [1].
 * `at` unknown, or its bytes not kept, claims the whole change.
 */
function splitAt(
  change: HistoryFileChange,
  at: string | undefined,
  kept: boolean,
): [HistoryFileChange | null, HistoryFileChange | null] {
  if (at === change.after) return [change, null];
  if (!at || at === change.before || !kept) return [null, change];
  return [
    { ...change, after: at },
    { ...change, before: at },
  ];
}

/** Files one change to a group; a later change to the same path keeps the group's first "before". */
function addChange(group: Group, path: string, before: string | null, after: string | null): void {
  const earlier = group.changes.get(path);
  const from = earlier ? earlier.before : before;
  if (from === after) group.changes.delete(path);
  else group.changes.set(path, { path, before: from, after });
}

class Engine {
  readonly dir: string;
  readonly home: string;
  log: HistoryLog = { baseline: new Map(), entries: [], pins: new Set() };
  tracked = new Map<string, Tracked>();
  windows: Group[] = [];
  outside: Group | null = null;
  /** A coalescing claim, open until another key, its idle timer, or an operation commits it. */
  claimed: { group: Group; key: string; timer: NodeJS.Timeout } | null = null;
  /** The running operation's write token (operations run one at a time). */
  writeToken: string | undefined;
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

  now(): number {
    return (this.options.now ?? Date.now)();
  }

  /** One operation at a time, in order: sweeps, windows and undos never interleave. */
  queue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task);
    this.tail = run.catch(() => undefined);
    return run;
  }

  async start(): Promise<void> {
    const log = readLog(this.logFile, (line) =>
      this.options.onError?.(
        new Error(`History log line ${line} could not be read and was skipped.`),
      ),
    );
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
    const sweptAt = Date.now();
    for (const file of listProjectFiles(this.dir))
      this.tracked.set(file.path, {
        hash: await this.blobs.put(join(this.dir, file.path)),
        stat: statKey(file, sweptAt),
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
    mkdirSync(this.home, { recursive: true });
    replaceFileAtomically(join(this.home, "stat.json"), files, 0o644);
  }

  /**
   * Takes in every write since the last sweep and files each change to its writer. ponytail: always the whole
   * project (a stat per file, a hash only when the stat moved); per-path sweeps if projects reach tens of thousands.
   */
  async sweep(): Promise<void> {
    // A missing project folder was moved or removed, not emptied: that is no change to its files.
    if (!existsSync(this.dir)) return;
    const sweptAt = Date.now();
    const seen = listProjectFiles(this.dir);
    let changed = false;
    for (const file of seen)
      changed = (await this.observe(file.path, statKey(file, sweptAt))) || changed;
    const present = new Set(seen.map((file) => file.path));
    for (const [path, known] of this.tracked) {
      if (present.has(path)) continue;
      this.tracked.delete(path);
      this.record(path, known.hash, null);
      changed = true;
    }
    if (changed) this.saveStatCache();
  }

  /** The file's hash once copied in; null when it was removed before the copy (the next sweep records that). */
  async storeIfPresent(path: string): Promise<string | null> {
    try {
      return await this.blobs.put(join(this.dir, path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async observe(path: string, stat: string): Promise<boolean> {
    const known = this.tracked.get(path) ?? { hash: null, stat: null };
    if (stat && known.stat === stat) return false;
    const hash = await this.storeIfPresent(path);
    if (hash === null) return false;
    this.tracked.set(path, { hash, stat });
    if (known.hash !== hash) this.record(path, known.hash, hash);
    return known.hash !== hash || known.stat !== stat;
  }

  record(path: string, before: string | null, after: string | null): void {
    const window = this.windows.at(-1);
    if (window) this.touch(window);
    addChange(window ?? this.outsideGroup(), path, before, after);
  }

  /**
   * ponytail: a claim cuts each change at the version the claimer says it overwrote, so an earlier write stays its
   * writer's. Another writer's write between Studio's write and the sweep that saw it (milliseconds) has no kept
   * version to cut at and folds into Studio's entry. Per-write tokens would split them.
   */
  async claimNow(
    who: HistoryWho,
    label: string,
    paths: readonly string[],
    { coalesceKey, idleMs, overwrote = {} }: ClaimOptions,
  ): Promise<{ id: string } | null> {
    await this.sweep();
    const taken = this.takeClaimed(who, paths, overwrote);
    if (!taken.length) {
      // A claim under another key still ends the held one.
      if (coalesceKey !== this.claimed?.key) await this.commitClaim();
      return null;
    }
    // What happened outside before this write is older than it, so it is logged first.
    await this.commitOutside();
    const group = await this.claimGroup(who, label, coalesceKey);
    for (const change of taken) addChange(group, change.path, change.before, change.after);
    if (coalesceKey) return this.holdClaim(group, coalesceKey, idleMs);
    const entry = await this.commit(group);
    return entry && { id: entry.id };
  }

  /** The held claim when the key matches; otherwise it is committed and a new group starts. */
  async claimGroup(who: HistoryWho, label: string, key: string | undefined): Promise<Group> {
    if (key && this.claimed?.key === key) return this.claimed.group;
    await this.commitClaim();
    return this.newGroup(who, label);
  }

  /** A path as the log names it: project-relative, forward slashes. */
  logPath(path: string): string {
    return relative(this.dir, resolve(this.dir, path)).split(sep).join("/");
  }

  /**
   * Removes and returns the uncommitted changes to `paths` (project-relative or absolute) filed outside or in another
   * writer's open window, each cut at the version `who` overwrote.
   */
  takeClaimed(
    who: HistoryWho,
    paths: readonly string[],
    overwrote: Readonly<Record<string, string>>,
  ): HistoryFileChange[] {
    const wanted = new Set(paths.map((path) => this.logPath(path)));
    const at = new Map(
      Object.entries(overwrote).map(([path, version]) => [
        this.logPath(path),
        hashOfVersion(version),
      ]),
    );
    const others = this.windows.filter((open) => !sameWho(open.who, who));
    const groups = this.outside ? [this.outside, ...others] : others;
    const taken: HistoryFileChange[] = [];
    for (const group of groups) {
      for (const change of [...group.changes.values()]) {
        if (!wanted.has(change.path)) continue;
        const cut = at.get(change.path);
        const [kept, claimed] = splitAt(change, cut, cut !== undefined && this.blobs.has(cut));
        group.changes.delete(change.path);
        if (kept) group.changes.set(kept.path, kept);
        if (claimed) taken.push(claimed);
      }
    }
    return taken;
  }

  holdClaim(
    group: Group,
    key: string,
    idleMs = this.options.quietMs ?? 2000,
  ): { id: string } | null {
    clearTimeout(this.claimed?.timer);
    const timer = setTimeout(() => this.background(() => this.commitClaim()), idleMs);
    timer.unref?.();
    this.claimed = { group, key, timer };
    return group.changes.size ? { id: group.id } : null;
  }

  async commitClaim(): Promise<void> {
    const held = this.claimed;
    this.claimed = null;
    if (!held) return;
    clearTimeout(held.timer);
    await this.commit(held.group);
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
    try {
      saveRecord(this.logFile, this.log, { type: "entry", entry });
    } catch (error) {
      this.log.entries.pop();
      throw error;
    }
    for (const listener of this.listeners) listener(entry);
    await this.keepWithinBudget();
    return entry;
  }

  /** Stored bytes beyond what the current files need: a project larger than the budget still keeps its history. */
  historyBytes(): number {
    let current = 0;
    for (const hash of new Set([...this.tracked.values()].map((file) => file.hash)))
      current += this.blobs.size(hash);
    return this.blobs.bytes() - current;
  }

  async keepWithinBudget(): Promise<void> {
    const budget = this.options.budgetBytes ?? 2 * 1024 ** 3;
    let folded = false;
    while (this.historyBytes() > budget && foldOldest(this.log)) {
      folded = true;
      await this.blobs.prune(referencedHashes(this.log, this.manifest()));
    }
    if (folded) writeLog(this.logFile, this.log);
  }

  /** Before an operation: every write so far is filed, and the outside group is closed so it sorts first. */
  async settle(): Promise<void> {
    await this.sweep();
    await this.commitClaim();
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

  beginWindow(who: HistoryWho, label: string, idleMs: number): Promise<HistoryWindow> {
    return this.queue(async () => {
      // Writes before the window opened are not this writer's.
      await this.sweep();
      const window = { ...this.newGroup(who, label), idleMs };
      this.windows.push(window);
      this.touch(window);
      return { id: window.id, close: () => this.queue(() => this.sweepAndEnd(window)) };
    });
  }

  /** A window with no write for its idleMs ends, so a close that never comes cannot hold every later write. */
  touch(window: Group): void {
    clearTimeout(window.idleTimer);
    if (window.idleMs === undefined || !Number.isFinite(window.idleMs)) return;
    window.idleTimer = setTimeout(
      () => this.background(() => this.sweepAndEnd(window)),
      window.idleMs,
    );
    window.idleTimer.unref?.();
  }

  async sweepAndEnd(window: Group): Promise<HistoryEntry | null> {
    await this.sweep();
    return this.endWindow(window);
  }

  /** Commits an open window once; ending it again returns the entry it became. */
  async endWindow(window: Group): Promise<HistoryEntry | null> {
    if (!this.windows.includes(window)) return window.entry ?? null;
    clearTimeout(window.idleTimer);
    this.windows = this.windows.filter((open) => open !== window);
    window.entry = await this.commit(window);
    return window.entry;
  }

  /** Every pending write, open window and outside group, committed: for flush and close. */
  async settleAll(): Promise<void> {
    await this.sweep();
    await this.commitClaim();
    for (const window of [...this.windows]) await this.endWindow(window);
    await this.commitOutside();
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
        if ((this.tracked.get(path)?.hash ?? null) !== hash)
          await this.writeProjectFile(path, hash);
      }
      await this.sweep();
    } finally {
      this.windows = this.windows.filter((open) => open !== group);
    }
    return this.commit(group, extra);
  }

  /** Writes one project file (null deletes it), first leaving the running operation's receipt for its echo. */
  async writeProjectFile(path: string, hash: string | null): Promise<void> {
    const absPath = join(this.dir, path);
    const { writeToken } = this;
    if (writeToken) {
      const version = hash === null ? DELETED_VERSION : hashVersion(hash);
      recordFileWriteReceipt(absPath, { path, version, writeToken });
    }
    if (hash === null) await rm(absPath, { force: true });
    else await this.blobs.writeTo(hash, absPath);
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

  conflict(
    entry: HistoryEntry,
    changed: HistoryFileChange[],
  ): { files: string[]; newer: string[] } {
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

  /** Settles, then runs `task` with its writes labelled `writeToken`. */
  operation<T>(writeToken: string | undefined, task: () => Promise<T>): Promise<T> {
    return this.queue(async () => {
      await this.settle();
      this.writeToken = writeToken;
      try {
        return await task();
      } finally {
        this.writeToken = undefined;
      }
    });
  }

  pointLabel(point: string): string {
    return point === START ? "the start" : this.entry(point).label;
  }

  api(): ProjectHistory {
    return {
      projectId: this.projectId,
      beginWindow: (who, label, options = {}) =>
        this.beginWindow(who, label, options.idleMs ?? this.options.maxGroupMs ?? 30_000),
      claim: (who, label, paths, options = {}) =>
        this.queue(() => this.claimNow(who, label, paths, options)),
      noteChange: (path) => this.noteChange(path),
      list: () => {
        const undone = undoneIds(this.log.entries);
        return this.log.entries.map((entry) => ({
          ...entry,
          pinned: this.log.pins.has(entry.id),
          undone: undone.has(entry.id),
        }));
      },
      step: (direction, who, { writeToken } = {}) =>
        this.operation(writeToken, async () => {
          const target = stepTarget(this.log.entries, direction);
          return target ? this.undoNow(target.id, who) : { ok: true, entry: null };
        }),
      undo: (id, { who, mode, writeToken }) =>
        this.operation(writeToken, () => this.undoNow(id, who, mode)),
      restore: (point, who, { writeToken } = {}) =>
        this.operation(writeToken, () =>
          this.restoreNow(point, who, `Restored: ${this.pointLabel(point)}`),
        ),
      peek: (point) => {
        const files = manifestAt(this.log, point);
        return files && Object.fromEntries(files);
      },
      readBlob: (hash) => this.blobs.read(hash),
      pin: (id, pinned) => {
        this.entry(id);
        if (pinned) this.log.pins.add(id);
        else this.log.pins.delete(id);
        saveRecord(this.logFile, this.log, { type: "pin", id, pinned });
      },
      onEntry: (listener) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      },
      flush: () => this.queue(() => this.settleAll()),
      close: async () => {
        if (this.notedTimer) clearTimeout(this.notedTimer);
        await this.queue(() => this.settleAll());
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
