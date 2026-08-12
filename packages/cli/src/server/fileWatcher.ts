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
const DEBOUNCE_MS = 300;

export function shouldWatchProjectFile(filename: string): boolean {
  if (!filename) return false;
  const parts = filename.split(/[\\/]+/);
  return !parts.some((part) => WATCHER_EXCLUDED_DIRS.has(part));
}

export function createProjectWatcher(projectDir: string): ProjectWatcher {
  const listeners = new Set<FileChangeListener>();
  const pendingPaths = new Set<string>();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let watcher: FSWatcher | null = null;

  try {
    watcher = watch(projectDir, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const relativePath = filename.toString();
      if (!shouldWatchProjectFile(relativePath)) return;

      pendingPaths.add(relativePath);
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const changedPaths = [...pendingPaths];
        pendingPaths.clear();
        debounceTimer = null;
        for (const changedPath of changedPaths) {
          for (const fn of listeners) {
            fn(changedPath);
          }
        }
      }, DEBOUNCE_MS);
    });
    // fs.watch can fail asynchronously too (e.g. EMFILE from exhausted OS watch
    // handles) — that surfaces as an 'error' event, not a thrown exception. An
    // EventEmitter 'error' with no listener crashes the whole process, so this
    // listener is required for the same "degrade gracefully" the catch below
    // already promises for the synchronous failure mode.
    watcher.on("error", () => {
      watcher?.close();
      watcher = null;
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
      watcher?.close();
      listeners.clear();
    },
  };
}
