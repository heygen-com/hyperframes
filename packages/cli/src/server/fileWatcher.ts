import { watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { affectsProjectSignature } from "@hyperframes/studio-server";

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
// A lone save reaches the preview after QUIET_MS; writes that keep coming after a flush
// (a checkout, a multi-file tool) coalesce over BURST_MS so each doesn't start a rebuild.
const QUIET_MS = 30;
const BURST_MS = 300;

export function shouldWatchProjectFile(filename: string): boolean {
  if (!filename) return false;
  const parts = filename.split(/[\\/]+/);
  return !parts.some((part) => WATCHER_EXCLUDED_DIRS.has(part));
}

export function createProjectWatcher(projectDir: string): ProjectWatcher {
  const listeners = new Set<FileChangeListener>();
  const pendingPaths = new Set<string>();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastFlushAt = Number.NEGATIVE_INFINITY;
  let watcher: FSWatcher | null = null;

  try {
    watcher = watch(projectDir, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const relativePath = filename.toString();
      // The reload filter excludes all of `.hyperframes/`, but two files in
      // there feed the preview signature and Studio writes one of them at
      // runtime — dropping those at ingest left the CLI server's ETag stale
      // until restart. Admit them here and let the reload listener re-apply
      // its own filter, so what triggers a browser reload is unchanged.
      if (
        !shouldWatchProjectFile(relativePath) &&
        !affectsProjectSignature(projectDir, join(projectDir, relativePath))
      ) {
        return;
      }

      pendingPaths.add(relativePath);
      if (debounceTimer) clearTimeout(debounceTimer);
      const delay = Date.now() - lastFlushAt < BURST_MS ? BURST_MS : QUIET_MS;
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
