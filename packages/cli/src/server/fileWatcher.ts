import { lstatSync, readdirSync, watch, type Dirent, type FSWatcher } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { isAtomicTempPath } from "@hyperframes/core/atomic-file";
import {
  affectsProjectSignature,
  STUDIO_SIGNATURE_MANIFEST_PATHS,
} from "@hyperframes/studio-server";

export type FileChangeListener = (relativePath: string) => void;

export interface ProjectWatcher {
  addListener(fn: FileChangeListener): void;
  removeListener(fn: FileChangeListener): void;
  close(): void;
}

const WATCHER_EXCLUDED_DIRS = new Set([
  ".cache",
  ".git",
  ".hyperframes",
  ".next",
  ".thumbnails",
  ".transcode-cache",
  ".vite",
  ".waveform-cache",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "outputs",
  "renders",
]);
// A save reaches the preview QUIET_MS after the writes go quiet, but at most once per BURST_MS,
// so a checkout or a multi-file tool doesn't start a rebuild for every file.
const QUIET_MS = 30;
const BURST_MS = 300;

export function shouldWatchProjectFile(filename: string): boolean {
  if (!filename || isAtomicTempPath(filename)) return false;
  const parts = filename.split(/[\\/]+/);
  return !parts.some((part) => WATCHER_EXCLUDED_DIRS.has(part));
}

function isDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

// On Linux, Node's `recursive` watch arms inotify per file inode, so a file replaced by rename
// (an atomic save) is never reported again; a watch per directory reports children by name.
function watchProjectTree(
  projectDir: string,
  onChange: (relativePath: string) => void,
): () => void {
  if (process.platform !== "linux") {
    const tree = watch(projectDir, { recursive: true }, (_event, filename) => {
      if (filename) onChange(filename.toString());
    });
    // An async 'error' (e.g. EMFILE) with no listener would crash the process.
    tree.on("error", () => tree.close());
    return () => tree.close();
  }

  const directories = new Map<string, FSWatcher>();
  const unwatch = (dir: string) => {
    for (const [watched, watcher] of directories) {
      if (watched === dir || watched.startsWith(dir + sep)) {
        watcher.close();
        directories.delete(watched);
      }
    }
  };
  const watchDirectory = (dir: string, movedIn = false) => {
    if (directories.has(dir)) unwatch(dir);
    let watcher: FSWatcher;
    try {
      watcher = watch(dir, { persistent: true }, (event, name) => {
        if (!name) return;
        const path = join(dir, name.toString());
        onChange(relative(projectDir, path));
        if (event !== "rename") return;
        if (isDirectory(path)) descend(path, true);
        else unwatch(path);
      });
    } catch {
      // A directory can vanish during replacement; its parent reports its return.
      return;
    }
    watcher.on("error", () => unwatch(dir));
    directories.set(dir, watcher);
    walkChildren(dir, movedIn);
  };
  const walkChildren = (dir: string, movedIn: boolean) => {
    let entries: Dirent[] = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      // Gone before we could list it; its parent reports the removal.
    }
    for (const entry of entries) {
      const child = join(dir, entry.name);
      // A folder moved in brings files that never get an event of their own, and drops others.
      if (entry.isDirectory()) descend(child, movedIn);
      else if (movedIn) onChange(relative(projectDir, child));
    }
    if (movedIn && relative(projectDir, dir) === ".hyperframes") {
      for (const manifest of STUDIO_SIGNATURE_MANIFEST_PATHS) onChange(manifest);
    }
  };
  // `.hyperframes/` itself holds the two manifests the signature reads; nothing below it matters.
  const descend = (dir: string, movedIn = false) => {
    const rel = relative(projectDir, dir);
    if (shouldWatchProjectFile(rel) || rel === ".hyperframes") watchDirectory(dir, movedIn);
  };

  let parent: FSWatcher | null = null;
  try {
    parent = watch(dirname(projectDir), { persistent: true }, (event, name) => {
      if (event !== "rename" || name?.toString() !== basename(projectDir)) return;
      watchDirectory(projectDir);
      onChange(".");
    });
    parent.on("error", () => parent?.close());
  } catch {
    // The project can remain watchable even when its parent is not.
  }
  watchDirectory(projectDir);
  return () => {
    parent?.close();
    for (const watcher of directories.values()) watcher.close();
    directories.clear();
  };
}

export function createProjectWatcher(projectDir: string): ProjectWatcher {
  const listeners = new Set<FileChangeListener>();
  const pendingPaths = new Set<string>();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastFlushAt = Number.NEGATIVE_INFINITY;
  let closeTree: (() => void) | null = null;

  try {
    closeTree = watchProjectTree(projectDir, (relativePath) => {
      // Studio's two manifests affect the signature despite the .hyperframes exclusion.
      // Admit them here; the reload listener still applies its own filter.
      if (
        !shouldWatchProjectFile(relativePath) &&
        !affectsProjectSignature(projectDir, join(projectDir, relativePath))
      ) {
        return;
      }

      pendingPaths.add(relativePath);
      if (debounceTimer) clearTimeout(debounceTimer);
      const delay = Math.max(QUIET_MS, lastFlushAt + BURST_MS - Date.now());
      debounceTimer = setTimeout(() => {
        const changedPaths = [...pendingPaths];
        pendingPaths.clear();
        debounceTimer = null;
        lastFlushAt = Date.now();
        for (const changedPath of changedPaths) {
          for (const fn of listeners) {
            fn(changedPath);
          }
        }
      }, delay);
    });
  } catch {
    // fs.watch may fail on some platforms — degrade gracefully (no auto-refresh)
  }

  return {
    addListener(fn) {
      listeners.add(fn);
    },
    removeListener(fn) {
      listeners.delete(fn);
    },
    close() {
      if (debounceTimer) clearTimeout(debounceTimer);
      pendingPaths.clear();
      closeTree?.();
      listeners.clear();
    },
  };
}
