import { isAbsolute, relative, resolve } from "node:path";

export function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveFromBase(baseDir: string, input: string): string {
  return isAbsolute(input) ? input : resolve(baseDir, input);
}

export function displayPathFromBase(baseDir: string, filePath: string): string {
  const rel = relative(baseDir, filePath);
  if (rel && !rel.startsWith("..") && !isAbsolute(rel)) return rel;
  return filePath;
}

export function displayPathFromInput(baseDir: string, input: string): string {
  return isAbsolute(input) ? displayPathFromBase(baseDir, input) : input;
}
