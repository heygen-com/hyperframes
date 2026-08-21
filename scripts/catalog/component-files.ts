/**
 * Locate the two files a variable-bearing component ships.
 *
 * Both the payload generator and the demo sync need the same thing: given a
 * component directory, the snippet that declares the variables and the demo
 * that stages it, or nothing when the component is not in that shape. Each had
 * grown its own copy of the lookup, which is the same drift-by-copying this
 * whole change exists to remove.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface Manifest {
  name: string;
  variables?: unknown[];
  files?: { path?: string; type?: string }[];
}

export interface ComponentFiles {
  name: string;
  /** Absolute path to the snippet the catalog hands a reader to paste. */
  snippetPath: string;
  /** Absolute path to `demo.html`, or null when the component ships none. */
  demoPath: string | null;
}

/** The path back, or null when nothing is there. */
function existingPath(path: string): string | null {
  return existsSync(path) ? path : null;
}

/** The manifest of a component that declares variables, or null for any other. */
function variableManifest(dir: string): Manifest | null {
  const path = existingPath(join(dir, "registry-item.json"));
  if (!path) return null;

  const manifest = JSON.parse(readFileSync(path, "utf-8")) as Manifest;
  return manifest.variables?.length ? manifest : null;
}

function snippetPathIn(dir: string, manifest: Manifest): string | null {
  const relative = manifest.files?.find((f) => f.type === "hyperframes:snippet")?.path;
  return relative ? existingPath(join(dir, relative)) : null;
}

/** Null when this directory is not a component that declares variables. */
export function componentFiles(dir: string): ComponentFiles | null {
  const manifest = variableManifest(dir);
  if (!manifest) return null;

  const snippetPath = snippetPathIn(dir, manifest);
  if (!snippetPath) return null;

  return { name: manifest.name, snippetPath, demoPath: existingPath(join(dir, "demo.html")) };
}
