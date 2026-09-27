import { resolve } from "node:path";

const CONFIG_FILE = "hyperframes.json";
// ponytail: grows until restart, so a file a film stopped using still reloads; reset per build if that matters.
const readsByProject = new Map<string, Set<string>>();

/** Note a project file the preview loaded, served or looked for; a later write to it reloads the preview. */
export function recordPreviewRead(projectDir: string, filePath: string): void {
  const key = resolve(projectDir);
  let reads = readsByProject.get(key);
  if (!reads) readsByProject.set(key, (reads = new Set()));
  reads.add(resolve(projectDir, filePath));
}

/**
 * Whether a write at `changedPath` (absolute, or relative to `projectDir`) can change what the preview shows.
 * With nothing recorded, as after a server restart under an open tab, every write counts.
 */
export function affectsPreview(projectDir: string, changedPath: string): boolean {
  const reads = readsByProject.get(resolve(projectDir));
  if (!reads?.size) return true;
  const changed = resolve(projectDir, changedPath);
  return reads.has(changed) || changed === resolve(projectDir, CONFIG_FILE);
}
