import { randomUUID } from "node:crypto";
import { readdir, rm, rmdir } from "node:fs/promises";
import {
  type Dirent,
  type Stats,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
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
import { takeHistoryOwnership } from "./ownerLock.js";
import {
  START,
  foldOldest,
  manifestAround,
  manifestAt,
  readLog,
  saveRecord,
  referencedHashes,
  stepTarget,
  undoneIds,
  writeLog,
  type HistoryEntry,
  type HistoryEntrySide,
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
  /** How long an open waits for another process to close the same history (default 5 s). */
  ownerWaitMs?: number;
  /** A CLI turn's window from an earlier open: writes since, within its idle limit, become the entry with its id. */
  closedWindow?: ClosedWindow;
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

export interface ClosedWindow {
  id: string;
  who: HistoryWho;
  label: string;
  startedAt: number;
  lastWriteAt: number;
  idleMs: number;
}

export const MAX_WINDOW_IDLE_MS = 10 * 60_000;

export const UNDO_MODES = ["just-this", "back-to-before", "keep-later-edits"] as const;
export type UndoMode = (typeof UNDO_MODES)[number];

export interface HistoryListItem extends HistoryEntry {
  pinned: boolean;
  undone: boolean;
}

export type HistoryResult =
  | { ok: true; entry: HistoryEntry | null }
  | { ok: false; conflict: { files: string[]; newer: string[] } };

export interface HistoryWindow {
  readonly id: string;
  readonly startedAt: number;
  /** Records everything written since the window opened as one entry (null when nothing changed); after the window
   * ended by itself or by flush, returns the entry it became. */
  close(): Promise<HistoryEntry | null>;
}

export interface ProjectHistory {
  readonly projectId: string;
  /** Writes until close() are one entry with the window's id; another writer or an operation meanwhile commits the
   * part so far first (fresh id), returned by close() if nothing else remained. Overlaps go to the newest. */
  beginWindow(
    who: HistoryWho,
    label: string,
    options?: { idleMs?: number },
  ): Promise<HistoryWindow>;
  /**
   * For a writer that records after writing (Studio): moves the uncommitted changes to `paths` into one entry of
   * `who`'s, each cut at the `overwrote` version so earlier parts stay their writer's. Same-key claims merge until
   * another key, idle, an operation, a window, or another write. Null when nothing was claimed or a drag nets to 0.
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
  /** Cmd+Z (back) and Cmd+Shift+Z (forward) over `who`'s own and outside changes; `writeToken` labels the echo. */
  step(direction: "back" | "forward", who: HistoryWho, options?: Writing): Promise<HistoryResult>;
  /** The entry `who`'s next step reverts, pending changes included, as of the last scan (a step scans first). */
  next(direction: "back" | "forward", who: HistoryWho): HistoryEntry | undefined;
  /** A file changed since returns a conflict; `mode` takes a choice (keep-later-edits: null when none is left). */
  undo(id: string, options: { who: HistoryWho; mode?: UndoMode } & Writing): Promise<HistoryResult>;
  /** Makes the files equal what they were right after `point` (an entry id, or START). */
  restore(point: string, who: HistoryWho, options?: Writing): Promise<HistoryEntry | null>;
  /** The files at `point` without writing anything: path to hash, read through readBlob. */
  peek(point: string): Record<string, string> | null;
  checkout(entryId: string, side: HistoryEntrySide, emptyDir: string): Promise<void>;
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
  /** Windows only: the idle lifetime, its timer, the last write's time, and the entry it became once ended. */
  idleMs?: number;
  lastWriteAt?: number;
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

/** Cuts a change at the overwritten `at`: [kept before it, claimed after]; `at` unknown or not kept claims all. */
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

const isMissingFolder = (error: unknown) =>
  ["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "");

/** Removes a folder at `dir` that holds only empty folders (inTheWay checked), so a file can take its place. */
async function removeEmptyFolders(dir: string): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isMissingFolder(error)) return;
    throw error;
  }
  for (const entry of entries)
    if (entry.isDirectory()) await removeEmptyFolders(join(dir, entry.name));
  await rmdir(dir);
}

/** The first file or link under folder `dir` (project path `at`) that `deleted` does not hold; links are not followed. */
function fileLeftIn(dir: string, at: string, deleted: ReadonlySet<string>): string | undefined {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${at}/${entry.name}`;
    const left = entry.isDirectory()
      ? fileLeftIn(join(dir, entry.name), path, deleted)
      : deleted.has(path)
        ? undefined
        : path;
    if (left) return left;
  }
  return undefined;
}

const blocks = (removed: string, added: string) =>
  added.startsWith(`${removed}/`) || removed.startsWith(`${added}/`);

/** A window takes a write within idleMs of its last one; past that it has ended, even before its timer commits it. */
const takesWrite = (window: Group, at: number) =>
  window.idleMs === undefined || at - (window.lastWriteAt ?? at) <= window.idleMs;

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
  /** A coalescing claim, open until another key, its idle timer, an operation, a window, or another write. */
  claimed: { group: Group; key: string; timer: NodeJS.Timeout } | null = null;
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
    // What changed while the project was closed is one outside entry, or the closed window's.
    this.reopenClosedWindow();
    await this.settleAll();
  }

  reopenClosedWindow(): void {
    const closed = this.options.closedWindow;
    if (!closed || this.log.entries.some((entry) => entry.id === closed.id)) return;
    const { id, who, label, startedAt, lastWriteAt, idleMs } = closed;
    this.windows.push({ id, who, label, startedAt, lastWriteAt, idleMs, changes: new Map() });
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
    const changedAt = (file: { mtimeMs: number; ctimeMs: number }) =>
      Math.min(sweptAt, Math.max(file.mtimeMs, file.ctimeMs));
    const seen = listProjectFiles(this.dir);
    const present = new Set(seen.map((file) => file.path));
    const removed = [...this.tracked.keys()]
      .filter((path) => !present.has(path))
      .map((path) => {
        const standing = this.standingAt(path);
        return { at: standing ? changedAt(standing.stat) : sweptAt, path, file: null };
      });
    // A file in the way of a removal (a/b over file a, or the reverse) appeared no earlier than that removal.
    const appearedAt = (file: (typeof seen)[number]) =>
      Math.max(
        changedAt(file),
        ...removed.filter((gone) => blocks(gone.path, file.path)).map((gone) => gone.at),
      );
    const events = [
      ...removed,
      ...seen.map((file) => ({ at: appearedAt(file), path: file.path, file })),
    ].sort((a, b) => a.at - b.at);
    let changed = false;
    for (const { at, path, file } of events) {
      if (file) {
        changed = (await this.observe(path, statKey(file, sweptAt), at)) || changed;
        continue;
      }
      const known = this.tracked.get(path)!;
      this.tracked.delete(path);
      await this.record(path, known.hash, null, at);
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

  async observe(path: string, stat: string, at: number): Promise<boolean> {
    const known = this.tracked.get(path) ?? { hash: null, stat: null };
    if (stat && known.stat === stat) return false;
    const hash = await this.storeIfPresent(path);
    if (hash === null) return false;
    this.tracked.set(path, { hash, stat });
    if (known.hash !== hash) await this.record(path, known.hash, hash, at);
    return known.hash !== hash || known.stat !== stat;
  }

  async record(
    path: string,
    before: string | null,
    after: string | null,
    at: number,
  ): Promise<void> {
    const endedBeforeThisWrite = this.windows.filter((open) => !takesWrite(open, at));
    if (endedBeforeThisWrite.length) await this.commitOutside();
    for (const window of endedBeforeThisWrite) await this.endWindow(window);
    const window = this.windows.at(-1);
    if (window) this.touch(window, at);
    addChange(window ?? this.outsideGroup(), path, before, after);
  }

  /** ponytail: another's write between Studio's write and its sweep folds into Studio's entry (per-write tokens). */
  async claimNow(
    who: HistoryWho,
    label: string,
    paths: readonly string[],
    { coalesceKey, idleMs, overwrote = {} }: ClaimOptions,
  ): Promise<{ id: string } | null> {
    await this.sweep();
    const taken = this.takeClaimed(who, paths, overwrote);
    if (!taken.length) return this.claimNothing(coalesceKey);
    const held = this.heldFor(coalesceKey, taken);
    if (!held) await this.commitClaim();
    await this.commitPending();
    const group = held ?? this.newGroup(who, label);
    for (const change of taken) addChange(group, change.path, change.before, change.after);
    if (coalesceKey) return this.holdClaim(group, coalesceKey, idleMs);
    const entry = await this.commit(group);
    return entry && { id: entry.id };
  }

  /** A claim that took nothing still ends a held claim under another key. */
  async claimNothing(coalesceKey: string | undefined): Promise<null> {
    if (coalesceKey !== this.claimed?.key) await this.commitClaim();
    return null;
  }

  /** Commits every other writer's pending changes, oldest first; open windows stay open. */
  async commitPending(): Promise<void> {
    await this.commitOutside();
    for (const window of [...this.windows])
      if (window.changes.size) await this.commitCut(window, [...window.changes.keys()]);
  }

  pendingElsewhere(): boolean {
    return (
      Boolean(this.outside?.changes.size) || this.windows.some((open) => open.changes.size > 0)
    );
  }

  /** The held claim `taken` continues: same key, each file from its own last change, no held file changed since. */
  heldFor(key: string | undefined, taken: readonly HistoryFileChange[]): Group | null {
    const group =
      key && this.claimed?.key === key && !this.pendingElsewhere() ? this.claimed.group : null;
    const after = (path: string, before: string | null) => {
      const own = group?.changes.get(path);
      return own ? own.after : before;
    };
    const takenPaths = new Set(taken.map((change) => change.path));
    const untouched = (change: HistoryFileChange) =>
      takenPaths.has(change.path) || (this.tracked.get(change.path)?.hash ?? null) === change.after;
    return group &&
      taken.every((change) => after(change.path, change.before) === change.before) &&
      [...group.changes.values()].every(untouched)
      ? group
      : null;
  }

  logPath(path: string): string {
    return relative(this.dir, resolve(this.dir, path)).split(sep).join("/");
  }

  /** Takes `paths`' uncommitted changes from others, cut at what `who` overwrote. */
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
        const claimed = this.cutOut(group, change, at.get(change.path));
        if (claimed) taken.push(claimed);
      }
    }
    return taken;
  }

  cutOut(group: Group, change: HistoryFileChange, cut: string | undefined) {
    const [kept, claimed] = splitAt(change, cut, cut !== undefined && this.blobs.has(cut));
    group.changes.delete(change.path);
    if (kept) group.changes.set(kept.path, kept);
    return claimed;
  }

  /** Commits the window's cut `paths` as their own entry, other files staying: a window holds one change per file,
   * so the writer's next write to a cut file would otherwise span the claimer's edit. */
  async commitCut(window: Group, paths: readonly string[]): Promise<void> {
    const part = { ...this.newGroup(window.who, window.label), startedAt: window.startedAt };
    for (const path of paths) {
      part.changes.set(path, window.changes.get(path)!);
      window.changes.delete(path);
    }
    window.entry = await this.commit(part);
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
    if (this.outside?.changes.size) await this.commitClaim();
    clearTimeout(this.quietTimer);
    clearTimeout(this.maxTimer);
    const group = this.outside;
    this.outside = null;
    if (group) await this.commit(group);
  }

  async commit(group: Group, extra: Partial<HistoryEntry> = {}): Promise<HistoryEntry | null> {
    if (!group.changes.size) return null;
    const pending = this.pendingEntry(group);
    const endedAt = Math.max(pending.endedAt, this.log.entries.at(-1)?.endedAt ?? 0);
    const entry: HistoryEntry = { ...pending, endedAt, ...extra };
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

  /** Before an operation or a window: every write is filed and every pending change committed, in write order. */
  async settle(): Promise<void> {
    await this.sweep();
    await this.commitClaim();
    await this.commitPending();
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
      // Writes before the window opened are not this writer's, and are logged before it.
      await this.settle();
      const window = { ...this.newGroup(who, label), idleMs };
      this.windows.push(window);
      this.touch(window, Date.now());
      const close = () => this.queue(() => this.sweepAndEnd(window));
      return { id: window.id, startedAt: window.startedAt, close };
    });
  }

  /** A window with no write for its idleMs ends, so a close that never comes cannot hold every later write. */
  touch(window: Group, at: number): void {
    window.lastWriteAt = Math.max(window.lastWriteAt ?? at, at);
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
    await this.commitClaim();
    this.windows = this.windows.filter((open) => open !== window);
    window.entry = (await this.commit(window)) ?? window.entry ?? null;
    return window.entry;
  }

  /** Every pending write, open window and outside group, committed: for flush and close. */
  async settleAll(): Promise<void> {
    await this.sweep();
    await this.commitClaim();
    for (const window of [...this.windows]) await this.endWindow(window);
    await this.commitOutside();
  }

  /** What took a removed path's place, dating its removal: an entry at the path, or a file at a folder above it. */
  standingAt(path: string): { at: string; stat: Stats } | undefined {
    const parts = path.split("/");
    for (let depth = 1; depth <= parts.length; depth += 1) {
      const at = parts.slice(0, depth).join("/");
      const stat = lstatSync(join(this.dir, at), { throwIfNoEntry: false });
      if (!stat) return undefined;
      if (at === path || !stat.isDirectory()) return { at, stat };
    }
    return undefined;
  }

  /** What the writes would have to delete to put `path` in place: a file or link at or above it, or a file in a folder at it. */
  inTheWay(path: string, deleted: ReadonlySet<string>): string | undefined {
    const standing = this.standingAt(path);
    if (!standing) return undefined;
    if (standing.stat.isSymbolicLink()) return standing.at;
    if (standing.at === path && !standing.stat.isDirectory()) return undefined;
    // On-disk names, so an entry `a` found at `A` on a case-insensitive disk matches its tracked paths.
    const real = realpathSync.native(join(this.dir, standing.at));
    const at = relative(realpathSync.native(this.dir), real).split(sep).join("/");
    if (standing.at !== path) return deleted.has(at) ? undefined : at;
    return fileLeftIn(real, at, deleted);
  }

  /** Writes `target` (path to hash, null deletes) as one entry of `who`'s. */
  async writeAs(
    who: HistoryWho,
    label: string,
    target: Map<string, string | null>,
    extra: Partial<HistoryEntry>,
  ): Promise<HistoryEntry | null> {
    const changes = [...target]
      .filter(([path, hash]) => (this.tracked.get(path)?.hash ?? null) !== hash)
      .sort(([, a], [, b]) => Number(a !== null) - Number(b !== null));
    const deleted = new Set(changes.filter(([, hash]) => hash === null).map(([path]) => path));
    const blocked = changes
      .filter(([, hash]) => hash !== null)
      .map(([path]) => this.inTheWay(path, deleted))
      .find(Boolean);
    if (blocked) throw new Error(`${blocked} is in the way; move or delete it, then try again.`);
    const group = this.newGroup(who, label);
    this.windows.push(group);
    try {
      for (const [path, hash] of changes) await this.writeProjectFile(path, hash);
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
    else {
      await removeEmptyFolders(absPath);
      await this.blobs.writeTo(hash, absPath);
    }
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

  async undoNow(id: string, who: HistoryWho, mode?: UndoMode): Promise<HistoryResult> {
    const entry = this.entry(id);
    const changed = this.movedOn(entry);
    if (changed.length && !mode) return { ok: false, conflict: this.conflict(entry, changed) };
    if (mode === "back-to-before") {
      const index = this.log.entries.indexOf(entry);
      const point = index > 0 ? this.log.entries[index - 1]!.id : START;
      return {
        ok: true,
        entry: await this.restoreNow(point, who, `Went back to before: ${entry.label}`),
      };
    }
    const target = new Map(
      entry.files
        .filter((file) => mode !== "keep-later-edits" || !changed.includes(file))
        .map((file) => [file.path, file.before]),
    );
    return {
      ok: true,
      entry: await this.writeAs(who, this.undoLabel(entry), target, { undoes: id }),
    };
  }

  movedOn(entry: HistoryEntry): HistoryFileChange[] {
    return entry.files.filter((file) => (this.tracked.get(file.path)?.hash ?? null) !== file.after);
  }

  next(direction: "back" | "forward", who: HistoryWho): HistoryEntry | undefined {
    // An outside change has no known author, so it is everyone's; a step commits it after the held claim.
    const mine = (author: HistoryWho) => sameWho(author, who) || sameWho(author, OUTSIDE);
    const pending = [...[...this.windows].reverse(), this.outside, this.claimed?.group].find(
      (group) => group?.changes.size && mine(group.who),
    );
    if (pending) return direction === "back" ? this.pendingEntry(pending) : undefined;
    return stepTarget(this.log.entries, direction, (entry) => mine(entry.who));
  }

  /** A pending group as the entry it becomes once committed (a window's part gets a fresh id). */
  pendingEntry(group: Group): HistoryEntry {
    const files = [...group.changes.values()].sort((a, b) => a.path.localeCompare(b.path));
    const { id, who, label, startedAt, lastWriteAt } = group;
    return { id, who, label, startedAt, endedAt: lastWriteAt ?? this.now(), files };
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
          const target = this.next(direction, who);
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
      checkout: (entryId, side, emptyDir) =>
        this.queue(async () => {
          this.entry(entryId);
          if (!existsSync(this.dir)) throw new Error(`The project folder is gone: ${this.dir}`);
          if (isWithin(this.dir, emptyDir))
            throw new Error(`Checkout writes outside the project only: ${emptyDir}`);
          if ((await readdir(emptyDir).catch(missingIsEmpty)).length > 0)
            throw new Error(`Checkout writes into an empty folder only: ${emptyDir}`);
          const files = manifestAround(this.log, entryId, side)!;
          try {
            for (const [path, hash] of files) await this.blobs.writeTo(hash, join(emptyDir, path));
          } catch (error) {
            for (const name of await readdir(emptyDir).catch(() => []))
              await rm(join(emptyDir, name), { recursive: true, force: true });
            throw error;
          }
        }),
      next: (direction, who) => this.next(direction, who),
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

/** Compares real on-disk paths; `.native` gives a case-insensitive disk's real letter case, so no alias gets in. */
function isWithin(dir: string, path: string): boolean {
  let probe = resolve(path);
  while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
  const rel = relative(realpathSync.native(dir), realpathSync.native(probe));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function missingIsEmpty(error: NodeJS.ErrnoException): string[] {
  if (error.code === "ENOENT") return [];
  throw error;
}

/** Opens a project's history: every write to its files becomes an entry that can be undone or restored. */
export async function openProjectHistory(options: ProjectHistoryOptions): Promise<ProjectHistory> {
  const projectId = projectHistoryId(options.projectDir, options.historyRoot);
  const release = await takeHistoryOwnership(
    join(options.historyRoot, projectId),
    options.ownerWaitMs ?? 5000,
  );
  try {
    const blobs = await openBlobStore(join(options.historyRoot, projectId, "blobs"));
    const engine = new Engine(options, projectId, blobs);
    await engine.queue(() => engine.start());
    const api = engine.api();
    return {
      ...api,
      close: () => api.close().finally(release),
    };
  } catch (error) {
    release();
    throw error;
  }
}
