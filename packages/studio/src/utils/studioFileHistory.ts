import type { EditHistoryKind } from "./editHistory";

interface SaveProjectFilesWithHistoryInput {
  projectId: string;
  label: string;
  kind: EditHistoryKind;
  coalesceKey?: string;
  files: Record<string, string>;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  recordEdit: (entry: {
    label: string;
    kind: EditHistoryKind;
    coalesceKey?: string;
    files: Record<string, { before: string; after: string }>;
  }) => Promise<void>;
}

export async function saveProjectFilesWithHistory({
  label,
  kind,
  coalesceKey,
  files,
  readFile,
  writeFile,
  recordEdit,
}: SaveProjectFilesWithHistoryInput): Promise<string[]> {
  const snapshots: Record<string, { before: string; after: string }> = {};
  for (const [path, after] of Object.entries(files)) {
    const before = await readFile(path);
    if (before !== after) {
      snapshots[path] = { before, after };
    }
  }

  const changedPaths = Object.keys(snapshots);
  if (changedPaths.length === 0) return [];

  for (const path of changedPaths) {
    await writeFile(path, snapshots[path].after);
  }

  await recordEdit({ label, kind, coalesceKey, files: snapshots });
  return changedPaths;
}
