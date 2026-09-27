import { sep } from "node:path";
import { shouldReloadPreview } from "@hyperframes/studio-server";

export function previewChangeOwner(
  watchedProjects: ReadonlyMap<string, string>,
  filePath: string,
): string | null {
  const owner = [...watchedProjects]
    .sort(([left], [right]) => right.length - left.length)
    .find(([dir]) => filePath.startsWith(dir + sep));
  if (!owner || !shouldReloadPreview(owner[0], filePath)) return null;
  return owner[1];
}
