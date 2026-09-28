import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { isHyperframesProject, PROJECT_MARKER_FILES } from "./projectRule";

export { isHyperframesProject, PROJECT_MARKER_FILES };

export interface FoundProject {
  path: string;
  name: string;
  source: "spotlight" | "walk";
  mtime: string;
}

export interface FindProjectsOptions {
  /** Defaults to the home folder. */
  root?: string;
  onProject: (project: FoundProject) => void;
  /** Stops the search: no `onProject` call after it fires, and the promise rejects with its reason. */
  signal?: AbortSignal;
  /** Paths of marker files already indexed under `root`; defaults to Spotlight on macOS. */
  spotlight?: (root: string, signal?: AbortSignal) => Promise<string[]>;
}

const WALK_CONCURRENCY = 64;

async function readEntries(dir: string): Promise<Dirent[] | null> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
}

/** A linked git worktree: its `.git` is a file naming a folder under the main repo's `.git/worktrees/`. */
async function isWorktreeCopy(dir: string, entries: Dirent[]): Promise<boolean> {
  if (!entries.some((entry) => entry.name === ".git" && entry.isFile())) return false;
  const gitFile = await readFile(join(dir, ".git"), "utf8").catch(() => "");
  return /[\\/]worktrees[\\/]/.test(gitFile);
}

const fileNames = (entries: Dirent[]) =>
  entries.filter((entry) => !entry.isDirectory()).map((entry) => entry.name);

function spotlightMarkers(root: string, signal?: AbortSignal): Promise<string[]> {
  if (process.platform !== "darwin") return Promise.resolve([]);
  const query = PROJECT_MARKER_FILES.map((name) => `kMDItemFSName == "${name}"`).join(" || ");
  return new Promise((resolve) => {
    execFile(
      "mdfind",
      ["-onlyin", root, query],
      { timeout: 10_000, maxBuffer: 64 * 1024 * 1024, signal },
      (error, stdout) => resolve(error ? [] : stdout.split("\n").filter(Boolean)),
    );
  });
}

/** Rejects with the file system error when `root` itself cannot be read; unreadable folders below it are skipped. */
export async function findProjects({
  root: givenRoot = homedir(),
  onProject,
  signal,
  spotlight = spotlightMarkers,
}: FindProjectsOptions): Promise<number> {
  signal?.throwIfAborted();
  const root = await realpath(givenRoot).catch(() => givenRoot);
  await readdir(root);
  const home = await realpath(homedir()).catch(() => homedir());
  const skippedDir = (parent: string, name: string) =>
    name.startsWith(".") || name === "node_modules" || (name === "Library" && parent === home);
  const reported = new Set<string>();
  let onProjectThrew = false;
  const stopped = () => onProjectThrew || signal?.aborted;
  const entriesByDir = new Map<string, Promise<Dirent[] | null>>();
  const entriesOf = (dir: string) => {
    let entries = entriesByDir.get(dir);
    if (!entries) entriesByDir.set(dir, (entries = readEntries(dir)));
    return entries;
  };

  async function report(dir: string, source: FoundProject["source"]) {
    const real = await realpath(dir).catch(() => dir);
    if (reported.has(real)) return;
    reported.add(real);
    const index = await stat(join(dir, "index.html")).catch(() => null);
    if (stopped()) return;
    try {
      onProject({
        path: dir,
        name: basename(dir),
        source,
        mtime: (index?.mtime ?? new Date(0)).toISOString(),
      });
    } catch (error) {
      onProjectThrew = true;
      throw error;
    }
  }

  async function walk() {
    const pending = [root];
    let active = 0;
    let failure: unknown;
    const visit = async (dir: string) => {
      const entries = await readEntries(dir);
      if (!entries || (dir !== root && (await isWorktreeCopy(dir, entries)))) return;
      if (isHyperframesProject(fileNames(entries))) return report(dir, "walk");
      for (const entry of entries) {
        if (entry.isDirectory() && !skippedDir(dir, entry.name))
          pending.push(join(dir, entry.name));
      }
    };
    await new Promise<void>((done) => {
      const pump = () => {
        while (active < WALK_CONCURRENCY && pending.length > 0 && !stopped()) {
          active++;
          void visit(pending.pop()!)
            .catch((error: unknown) => {
              failure ??= error;
            })
            .finally(() => {
              active--;
              pump();
            });
        }
        if (active === 0 && (pending.length === 0 || stopped())) done();
      };
      pump();
    });
    if (failure) throw failure;
  }

  // Folder names from the root down to `dir`, or null if the walk would skip one of them by name.
  function namesBelowRoot(dir: string): string[] | null {
    const inside = relative(root, dir);
    if (inside.startsWith("..") || isAbsolute(inside)) return null;
    const names = inside === "" ? [] : inside.split(sep);
    let parent = root;
    for (const name of names) {
      if (skippedDir(parent, name)) return null;
      parent = join(parent, name);
    }
    return names;
  }

  async function walkStopsAt(dir: string): Promise<boolean> {
    const entries = await entriesOf(dir);
    return !entries || (dir !== root && (await isWorktreeCopy(dir, entries)));
  }

  async function walkWouldReach(dir: string): Promise<boolean> {
    const names = namesBelowRoot(dir);
    if (!names) return false;
    let current = root;
    for (const name of names) {
      if (await walkStopsAt(current)) return false;
      if (isHyperframesProject(fileNames((await entriesOf(current))!))) return false;
      current = join(current, name);
    }
    return !(await walkStopsAt(current));
  }

  async function fromSpotlight() {
    const dirs = new Set((await spotlight(root, signal)).map((marker) => dirname(marker)));
    await Promise.all(
      [...dirs].map(async (dir) => {
        if (stopped() || !(await walkWouldReach(dir))) return;
        const entries = await entriesOf(dir);
        if (entries && isHyperframesProject(fileNames(entries))) await report(dir, "spotlight");
      }),
    );
  }

  await Promise.all([fromSpotlight(), walk()]);
  signal?.throwIfAborted();
  return reported.size;
}
