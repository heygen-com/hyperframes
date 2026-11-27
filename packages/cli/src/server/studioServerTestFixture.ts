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
export async function cleanupStudioServerRoot(
  server: { watcher: { close(): void }; shutdown(): Promise<void> },
  root: string,
  onDone?: () => void,
): Promise<void> {
  server.watcher.close();
  await server.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
  onDone?.();
}

/** Windows refuses to rename a folder while a file in it is open: waits for the server's history there to finish writing. */
export async function historyWritesSettled(
  server: { adapter: { history?: (project: never) => unknown } },
  projectDir: string,
): Promise<void> {
  const project = {
    dir: projectDir,
    id: path.basename(projectDir),
    title: path.basename(projectDir),
  };
  const history = (await server.adapter.history?.(project as never)) as {
    flush(): Promise<void>;
  } | null;
  if (!history) throw new Error(`No history is open for ${projectDir} to wait for`);
  await history.flush();
}
