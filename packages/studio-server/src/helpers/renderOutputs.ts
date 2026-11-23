import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { replaceFileAtomically } from "@hyperframes/core/atomic-file";
import { takeHistoryOwnership } from "../history/ownerLock.js";
import { pinProjectRecord } from "./safePath.js";

const manifest = ".hyperframes/render-outputs.json";

export function readRenderOutputs(projectDir: string): string[] {
  const path = pinProjectRecord(projectDir, manifest);
  if (!path) return [];
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return [];
    throw error;
  }
  const value = JSON.parse(text);
  if (
    value.version !== 1 ||
    !Array.isArray(value.paths) ||
    !value.paths.every(
      (p: unknown) =>
        typeof p === "string" &&
        p !== "" &&
        !isAbsolute(p) &&
        !p.split(/[\\/]/).some((part) => part === ".." || part === "."),
    )
  )
    throw new Error("Invalid render output registry.");
  return value.paths;
}

export function readRenderOutputsOrNone(projectDir: string): string[] {
  try {
    return readRenderOutputs(projectDir);
  } catch {
    return [];
  }
}

export function isRenderOutput(
  projectDir: string,
  path: string,
  outputs: readonly string[],
): boolean {
  const candidate = relative(resolve(projectDir), resolve(path)).split(sep).join("/");
  return outputs.some((output) => candidate === output || candidate.startsWith(`${output}/`));
}

export async function registerRenderOutput(projectDir: string, output: string): Promise<void> {
  const path = relative(resolve(projectDir), resolve(output)).split(sep).join("/");
  if (path === "") throw new Error("Render output cannot replace the project directory.");
  if (isAbsolute(path) || path === ".." || path.startsWith("../")) return;
  const registry = pinProjectRecord(projectDir, manifest);
  const lock = pinProjectRecord(projectDir, ".hyperframes/render-outputs-lock");
  if (!registry || !lock) throw new Error("Render output registry must stay inside the project.");
  const release = await takeHistoryOwnership(lock, 5000);
  try {
    const paths = [...new Set([...readRenderOutputs(projectDir), path])].sort();
    replaceFileAtomically(registry, JSON.stringify({ version: 1, paths }) + "\n", 0o644);
  } finally {
    release();
  }
}
