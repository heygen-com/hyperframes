import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { processIsAlive } from "../utils/processTree.js";

const COMPILED_MODEL = /^onnxruntime-.*\.mlmodelc?$/;

const COREML_TEMP_MANIFESTS = join(
  homedir(),
  ".cache",
  "hyperframes",
  "background-removal",
  "coreml-temp",
);

interface Manifest {
  pid: number;
  tmp: string;
  dirs: string[];
}

interface Options {
  manifests?: string;
  tmp?: string;
  alive?: (pid: number) => boolean;
}

const compiledModels = (tmp: string): string[] =>
  readdirSync(tmp).filter((name) => COMPILED_MODEL.test(name));

function readManifest(path: string): Manifest | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Manifest;
    return Number.isInteger(parsed.pid) && Array.isArray(parsed.dirs) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Removes the compiled models a run left in the system temp folder when it was killed before it could release them. */
export function sweepDeadCoreMlTemp(options: Options = {}): void {
  const { manifests = COREML_TEMP_MANIFESTS, alive = processIsAlive } = options;
  let names: string[];
  try {
    names = readdirSync(manifests);
  } catch {
    return;
  }
  for (const name of names) {
    const path = join(manifests, name);
    const manifest = readManifest(path);
    if (manifest && (manifest.pid === process.pid || alive(manifest.pid))) continue;
    for (const dir of manifest?.dirs ?? []) {
      if (basename(dir) === dir && COMPILED_MODEL.test(dir)) {
        rmSync(join(manifest!.tmp, dir), { recursive: true, force: true });
      }
    }
    rmSync(path, { force: true });
  }
}

/**
 * CoreML compiles the model into one temp folder per partition and only removes them when the session is released;
 * a killed run leaves them behind. This names the ones this run made so the next run can remove them.
 */
export function trackCoreMlTemp(options: Options = {}) {
  const { manifests = COREML_TEMP_MANIFESTS, tmp = tmpdir() } = options;
  sweepDeadCoreMlTemp(options);
  const before = new Set(compiledModels(tmp));
  const path = join(manifests, `${process.pid}.json`);
  return {
    record(): void {
      const dirs = compiledModels(tmp).filter((name) => !before.has(name));
      mkdirSync(manifests, { recursive: true });
      const manifest: Manifest = { pid: process.pid, tmp, dirs };
      writeFileSync(path, JSON.stringify(manifest));
    },
    forget(): void {
      rmSync(path, { force: true });
    },
  };
}
