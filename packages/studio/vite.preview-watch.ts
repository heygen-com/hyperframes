import { sep } from "node:path";

/** The watched project that owns `filePath`, nearest root first when projects nest. */
export function previewChangeOwner(
  watchedProjects: ReadonlyMap<string, string>,
  filePath: string,
): { projectDir: string; projectId: string } | null {
  const owner = [...watchedProjects]
    .sort(([left], [right]) => right.length - left.length)
    .find(([dir]) => filePath.startsWith(dir + sep));
  return owner ? { projectDir: owner[0], projectId: owner[1] } : null;
}
