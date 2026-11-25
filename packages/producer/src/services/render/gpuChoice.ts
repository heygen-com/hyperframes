import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { EngineConfig } from "@hyperframes/engine";

export type GpuChoice = "software" | "hardware";

/** Where this machine's measured GPU choice lives, and the key it is valid for. */
export interface GpuChoiceStore {
  file: string;
  key: string;
}

/** A store only when the caller gave a file and version and the probe reached a hardware GPU. */
export function gpuChoiceStore(
  cfg: Pick<EngineConfig, "gpuChoiceFile" | "hyperframesVersion">,
  gpu: string | undefined,
): GpuChoiceStore | undefined {
  if (!cfg.gpuChoiceFile || !cfg.hyperframesVersion || !gpu) return undefined;
  return { file: cfg.gpuChoiceFile, key: `${cfg.hyperframesVersion} | ${gpu}` };
}

/** The stored choice when it was measured for this key; undefined means measure. */
export function readGpuChoice(store: GpuChoiceStore): GpuChoice | undefined {
  let record: { key?: unknown; mode?: unknown };
  try {
    record = JSON.parse(readFileSync(store.file, "utf8")) as typeof record;
  } catch {
    // expected: no file yet, or one this version cannot read; both mean measure again
    return undefined;
  }
  if (record?.key !== store.key) return undefined;
  return record.mode === "software" || record.mode === "hardware" ? record.mode : undefined;
}

export function writeGpuChoice(
  store: GpuChoiceStore,
  mode: GpuChoice,
  measured: { hardwareP95Ms?: number; softwareP95Ms?: number },
): void {
  mkdirSync(dirname(store.file), { recursive: true });
  const temp = `${store.file}.${process.pid}.tmp`;
  const record = { key: store.key, mode, ...measured, measuredAt: new Date().toISOString() };
  writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`);
  renameSync(temp, store.file);
}
