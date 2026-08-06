import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { PrimitiveFunnelContext } from "./primitive-funnel.js";

const FUNNEL_STATE_DIR = ".hyperframes";
const FUNNEL_STATE_FILE = "primitive-funnel.json";

interface PersistedPrimitiveFunnelContext extends PrimitiveFunnelContext {
  emittedEventIds: string[];
}

function statePath(projectDir: string): string {
  return join(projectDir, FUNNEL_STATE_DIR, FUNNEL_STATE_FILE);
}

function isContext(value: unknown): value is PrimitiveFunnelContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return [
    "funnelId",
    "installId",
    "artifactId",
    "versionId",
    "catalogVersion",
    "queryFingerprint",
  ].every((key) => typeof record[key] === "string" && record[key].length > 0);
}

export function readPrimitiveFunnelContext(projectDir: string): PrimitiveFunnelContext | null {
  try {
    const value: unknown = JSON.parse(readFileSync(statePath(projectDir), "utf8"));
    if (!isContext(value)) return null;
    const { funnelId, installId, artifactId, versionId, catalogVersion, queryFingerprint } = value;
    return { funnelId, installId, artifactId, versionId, catalogVersion, queryFingerprint };
  } catch {
    return null;
  }
}

function writeState(projectDir: string, state: PersistedPrimitiveFunnelContext): void {
  const directory = join(projectDir, FUNNEL_STATE_DIR);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = statePath(projectDir);
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporaryPath, path);
}

export function writePrimitiveFunnelContext(
  projectDir: string,
  context: PrimitiveFunnelContext,
): void {
  writeState(projectDir, { ...context, emittedEventIds: [] });
}

/** Atomically claim a stable terminal id before enqueueing cross-command telemetry. */
export function claimPrimitiveFunnelEvent(projectDir: string, eventId: string): boolean {
  try {
    const value: unknown = JSON.parse(readFileSync(statePath(projectDir), "utf8"));
    if (!isContext(value)) return false;
    const record = value as PrimitiveFunnelContext & { emittedEventIds?: unknown };
    const emittedEventIds = Array.isArray(record.emittedEventIds)
      ? record.emittedEventIds.filter(
          (candidate): candidate is string => typeof candidate === "string",
        )
      : [];
    if (emittedEventIds.includes(eventId)) return false;
    const context = readPrimitiveFunnelContext(projectDir);
    if (!context) return false;
    writeState(projectDir, { ...context, emittedEventIds: [...emittedEventIds, eventId] });
    return true;
  } catch {
    return false;
  }
}
