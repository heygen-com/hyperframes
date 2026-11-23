import { resolve } from "node:path";
import { artifactDirectory, finishSnapshotRun } from "@hyperframes/studio-server/history";
import { projectFolder } from "./projectRecords.js";

const runDirectories = new Map<string, string>();
const activeChecks = new Map<string, number>();

export function beginCheckSnapshots(projectDir: string): void {
  const project = resolve(projectDir);
  activeChecks.set(project, (activeChecks.get(project) ?? 0) + 1);
}

export function checkSnapshotDirectory(projectDir: string): string {
  const project = resolve(projectDir);
  let directory = runDirectories.get(project);
  if (!directory) {
    directory = artifactDirectory(project, "snapshots");
    runDirectories.set(project, directory);
  }
  if (!projectFolder(project, directory))
    throw new Error(`${directory} is reached through a link or a file; remove it and run again`);
  return directory;
}

export async function finishCheckSnapshots(projectDir: string): Promise<void> {
  const project = resolve(projectDir);
  const remaining = Math.max(0, (activeChecks.get(project) ?? 1) - 1);
  if (remaining > 0) {
    activeChecks.set(project, remaining);
    return;
  }
  activeChecks.delete(project);
  const path = runDirectories.get(project);
  if (!path) return;
  runDirectories.delete(project);
  await finishSnapshotRun(project, path);
}
