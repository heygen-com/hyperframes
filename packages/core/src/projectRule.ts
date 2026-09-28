/** Files that `hyperframes init` or another HyperFrames tool writes at a project's root, next to its `index.html`. */
export const PROJECT_MARKER_FILES = ["hyperframes.json", "meta.json", "project.json"] as const;

export function isHyperframesProject(fileNames: Iterable<string>): boolean {
  const names = new Set(fileNames);
  return names.has("index.html") && PROJECT_MARKER_FILES.some((name) => names.has(name));
}
