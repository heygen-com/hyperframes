export function recordPathInProject(projectDir: string, recordPath: unknown): string | null;
export function resolveInsideProject(projectDir: string, path: string): string | null;
export function readFileInsideProject(
  projectDir: string,
  path: string,
): { path: string; bytes: Buffer } | null;
export function insideProject(projectDir: string, path: string): string | null;
