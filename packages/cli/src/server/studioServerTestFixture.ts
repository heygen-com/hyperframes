import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";

/**
 * Temp root plus empty `studio/assets` and `project` dirs, shared by every
 * studioServer static-file test; each caller writes its own fixture files
 * into the returned `studioDir` before constructing the server.
 */
export function makeStudioServerRoot(prefix: string): {
  root: string;
  studioDir: string;
  projectDir: string;
} {
  const root = fs.mkdtempSync(path.join(tmpdir(), prefix));
  const studioDir = path.join(root, "studio");
  const projectDir = path.join(root, "project");
  fs.mkdirSync(projectDir);
  fs.mkdirSync(path.join(studioDir, "assets"), { recursive: true });
  return { root, studioDir, projectDir };
}

/** The one SPA shell every studioServer static-file test needs, unchanged. */
export function writeStudioIndexHtml(studioDir: string): void {
  fs.writeFileSync(
    path.join(studioDir, "index.html"),
    "<html><head></head><body>Studio</body></html>",
  );
}

/** Pairs with makeStudioServerRoot; `onDone` resets caller-local state (e.g. the `hooks.studioDir` mock target). */
export function cleanupStudioServerRoot(
  server: { watcher: { close(): void } },
  root: string,
  onDone?: () => void,
): void {
  server.watcher.close();
  fs.rmSync(root, { recursive: true, force: true });
  onDone?.();
}
