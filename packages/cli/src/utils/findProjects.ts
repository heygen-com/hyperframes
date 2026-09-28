import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { isHyperframesProject, PROJECT_MARKER_FILES } from "@hyperframes/core";

export interface FoundProject {
  path: string;
  name: string;
  source: "spotlight" | "walk";
  mtime: string;
}

export interface FindProjectsOptions {
  root: string;
  onProject: (project: FoundProject) => void;
  /** Paths of marker files already indexed under `root`; defaults to Spotlight on macOS. */
  spotlight?: (root: string) => Promise<string[]>;
}

const WALK_CONCURRENCY = 64;
const HOME = homedir();

const skippedDir = (parent: string, name: string) =>
  name.startsWith(".") || name === "node_modules" || (name === "Library" && parent === HOME);

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

function spotlightMarkers(root: string): Promise<string[]> {
  if (process.platform !== "darwin") return Promise.resolve([]);
  const query = PROJECT_MARKER_FILES.map((name) => `kMDItemFSName == "${name}"`).join(" || ");
  return new Promise((resolve) => {
    execFile(
      "mdfind",
      ["-onlyin", root, query],
      { timeout: 10_000, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout) => resolve(error ? [] : stdout.split("\n").filter(Boolean)),
    );
  });
}

export async function findProjects({
  root: givenRoot,
  onProject,
  spotlight = spotlightMarkers,
}: FindProjectsOptions): Promise<number> {
  const root = await realpath(givenRoot).catch(() => givenRoot);
  const reported = new Set<string>();
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
    onProject({
      path: dir,
      name: basename(dir),
      source,
      mtime: (index?.mtime ?? new Date(0)).toISOString(),
    });
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
        if (entry.isDirectory() && !skippedDir(dir, entry.name)) pending.push(join(dir, entry.name));
      }
    };
    await new Promise<void>((done) => {
      const pump = () => {
        while (active < WALK_CONCURRENCY && pending.length > 0) {
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
        if (active === 0 && pending.length === 0) done();
      };
      pump();
    });
    if (failure) throw failure;
  }

  // The walk would reach the same folder only if nothing on the way down stops it.
  async function walkWouldReach(dir: string): Promise<boolean> {
    const inside = relative(root, dir);
    if (inside === "") return true;
    if (inside.startsWith("..") || isAbsolute(inside)) return false;
    const parts = inside.split(sep);
    let parent = root;
    for (const part of parts) {
      if (skippedDir(parent, part)) return false;
      parent = join(parent, part);
    }
    let current = root;
    for (const part of parts) {
      const entries = await entriesOf(current);
      if (!entries || (current !== root && (await isWorktreeCopy(current, entries)))) return false;
      if (isHyperframesProject(fileNames(entries))) return false;
      current = join(current, part);
    }
    const entries = await entriesOf(current);
    return !!entries && !(await isWorktreeCopy(current, entries));
  }

  async function fromSpotlight() {
    const dirs = new Set((await spotlight(root)).map((marker) => dirname(marker)));
    await Promise.all(
      [...dirs].map(async (dir) => {
        if (!(await walkWouldReach(dir))) return;
        const entries = await entriesOf(dir);
        if (entries && isHyperframesProject(fileNames(entries))) await report(dir, "spotlight");
      }),
    );
  }

  await Promise.all([fromSpotlight(), walk()]);
  return reported.size;
}
