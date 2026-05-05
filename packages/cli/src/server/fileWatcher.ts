import { watch, type FSWatcher } from "node:fs";

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
  ".vite",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "outputs",
  "renders",
]);
const DEBOUNCE_MS = 300;

export function shouldWatchProjectFile(filename: string): boolean {
  if (!filename) return false;
  const parts = filename.split(/[\\/]+/);
  return !parts.some((part) => WATCHER_EXCLUDED_DIRS.has(part));
}

export function createProjectWatcher(projectDir: string): ProjectWatcher {
  const listeners = new Set<FileChangeListener>();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let watcher: FSWatcher | null = null;

  try {
    watcher = watch(projectDir, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const relativePath = filename.toString();
      if (!shouldWatchProjectFile(relativePath)) return;

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        for (const fn of listeners) {
          fn(relativePath);
        }
      }, DEBOUNCE_MS);
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
      watcher?.close();
      listeners.clear();
    },
  };
}
