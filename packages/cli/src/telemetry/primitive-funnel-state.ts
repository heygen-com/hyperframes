import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import type { PrimitiveFunnelContext } from "./primitive-funnel.js";

const FUNNEL_STATE_DIR = ".hyperframes";
const FUNNEL_STATE_FILE = "primitive-funnel.json";
const FUNNEL_CLAIM_DIR = "primitive-funnel-claims";

interface PersistedPrimitiveFunnelContext extends PrimitiveFunnelContext {
  emittedEventIds: string[];
}

function statePath(projectDir: string): string {
  return join(projectDir, FUNNEL_STATE_DIR, FUNNEL_STATE_FILE);
}

function claimMarkerPath(projectDir: string, eventId: string): string {
  const directory = join(projectDir, FUNNEL_STATE_DIR, FUNNEL_CLAIM_DIR);
  const digest = createHash("sha256").update(eventId).digest("hex");
  return join(directory, `${digest}.claim`);
}

function createClaimMarker(projectDir: string, eventId: string): boolean {
  mkdirSync(join(projectDir, FUNNEL_STATE_DIR, FUNNEL_CLAIM_DIR), {
    recursive: true,
    mode: 0o700,
  });
  try {
    const descriptor = openSync(claimMarkerPath(projectDir, eventId), "wx", 0o600);
    closeSync(descriptor);
    return true;
  } catch {
    return false;
  }
}

function isContext(value: unknown): value is PrimitiveFunnelContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return [
    "funnelId",
    "installId",
    "primitiveId",
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
    const {
      funnelId,
      installId,
      primitiveId,
      artifactId,
      versionId,
      catalogVersion,
      queryFingerprint,
    } = value;
    return {
      funnelId,
      installId,
      primitiveId,
      artifactId,
      versionId,
      catalogVersion,
      queryFingerprint,
    };
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

function readEmittedEventIds(projectDir: string): string[] {
  try {
    const value: unknown = JSON.parse(readFileSync(statePath(projectDir), "utf8"));
    if (!isContext(value)) return [];
    const record = value as PrimitiveFunnelContext & { emittedEventIds?: unknown };
    if (!Array.isArray(record.emittedEventIds)) return [];
    return record.emittedEventIds.filter(
      (candidate): candidate is string => typeof candidate === "string",
    );
  } catch {
    return [];
  }
}

/** Atomically claim a stable terminal id before enqueueing cross-command telemetry. */
export function claimPrimitiveFunnelEvent(projectDir: string, eventId: string): boolean {
  try {
    const value: unknown = JSON.parse(readFileSync(statePath(projectDir), "utf8"));
    if (!isContext(value)) return false;
    const emittedEventIds = readEmittedEventIds(projectDir);
    if (emittedEventIds.includes(eventId)) return false;
    const context = readPrimitiveFunnelContext(projectDir);
    if (!context) return false;
    if (!createClaimMarker(projectDir, eventId)) return false;
    try {
      writeState(projectDir, { ...context, emittedEventIds: [...emittedEventIds, eventId] });
    } catch {
      // The permanent O_EXCL marker is the authoritative claim. Retaining it
      // fails closed if the compatibility state rewrite cannot complete.
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Hand a claim back after a delivery attempt PostHog never acknowledged.
 *
 * The claim has to be taken before the send, because its whole job is to stop
 * two concurrent processes both emitting one terminal event. That ordering
 * means an unacknowledged send would otherwise burn the claim permanently and
 * the step could never be emitted again — the funnel loses it for good.
 * Releasing trades that permanent loss for a possible duplicate on a later
 * command, which is the cheaper failure: every funnel event carries a stable
 * `event_id`, so duplicates collapse downstream while a loss is unrecoverable.
 */
export function releasePrimitiveFunnelEvent(projectDir: string, eventId: string): void {
  try {
    rmSync(claimMarkerPath(projectDir, eventId), { force: true });
  } catch {
    // Best effort. A retained marker only costs one un-emitted event, which is
    // exactly the state we were already in.
  }
  try {
    const context = readPrimitiveFunnelContext(projectDir);
    if (!context) return;
    writeState(projectDir, {
      ...context,
      emittedEventIds: readEmittedEventIds(projectDir).filter((id) => id !== eventId),
    });
  } catch {
    // The marker is the authoritative claim; the id list is a compatibility
    // mirror, so failing to prune it cannot resurrect a consumed claim.
  }
}
