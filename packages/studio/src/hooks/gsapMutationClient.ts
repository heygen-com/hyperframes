import { studioWriteHeaders } from "../utils/studioFileVersion";

export class GsapPreviewConvergenceError extends Error {}
export class GsapOwnershipProtocolError extends GsapPreviewConvergenceError {}

/** Verify rollback ownership support before any GSAP mutation can land. */
export async function requireGsapOwnershipProtocol(projectId: string): Promise<void> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/gsap-mutation-capabilities`,
  );
  if (!response.ok) {
    throw new GsapOwnershipProtocolError("Server does not support owned GSAP mutations");
  }
  const body = await response.json().catch(() => null);
  if (!isRecord(body) || body.atomicOwnershipPairs !== true) {
    throw new GsapOwnershipProtocolError("Invalid GSAP mutation capability response");
  }
}

/** Atomically restore one GSAP mutation only while its exact output still owns
 * the file. The server performs compare + write synchronously, eliminating the
 * client GET→PUT window that could overwrite a successor edit. */
export async function rollbackOwnedMutation(
  projectId: string,
  targetPath: string,
  expected: string,
  restore: string,
): Promise<"restored" | "conflict"> {
  if (targetPath.includes("\0") || targetPath.includes("..")) {
    throw new Error(`Unsafe path: ${targetPath}`);
  }
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/gsap-mutation-rollback/${encodeURIComponent(targetPath)}`,
    {
      method: "POST",
      // Deliberately unclaimed: a rollback runs because a mutation did not
      // converge, so let the restored file reload the preview.
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expected, restore }),
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to restore ${targetPath}`);
  }
  const result = (await response.json()) as { restored?: unknown; conflict?: unknown };
  if (result.restored === true && result.conflict === false) return "restored";
  if (result.restored === false && result.conflict === true) return "conflict";
  throw new Error(`Invalid restore response for ${targetPath}`);
}

/** The server's GSAP-mutation response. `scriptText` is the rewritten root script for a soft
 * reload, null when none came back: the caller then full-reloads when `mutated`, or rebinds
 * the runtime timing in place when nothing was rewritten (see syncTimingEditPreview). */
export type GsapMutationStatus = {
  mutated: boolean;
  scriptText: string | null;
  /** Atomic whole-file ownership pair returned by the mutation endpoint. */
  before?: string;
  after?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readMutationStatus(value: unknown): GsapMutationStatus {
  if (
    !isRecord(value) ||
    typeof value.mutated !== "boolean" ||
    typeof value.before !== "string" ||
    typeof value.after !== "string" ||
    value.mutated !== (value.before !== value.after) ||
    ("changed" in value && value.changed !== value.mutated)
  ) {
    throw new GsapOwnershipProtocolError("Invalid owned GSAP mutation response");
  }
  return {
    mutated: value.mutated,
    scriptText: typeof value.scriptText === "string" ? value.scriptText : null,
    before: value.before,
    after: value.after,
  };
}

function readMutationError(value: unknown, fallback: string): string {
  if (isRecord(value) && typeof value.error === "string") return value.error;
  return fallback;
}

export async function postGsapMutation(
  projectId: string,
  filePath: string,
  mutation: Record<string, unknown>,
  fallback: string,
): Promise<GsapMutationStatus> {
  let response: Response;
  try {
    response = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/gsap-mutations/${encodeURIComponent(filePath)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...studioWriteHeaders() },
        body: JSON.stringify(mutation),
      },
    );
  } catch (error) {
    throw new GsapPreviewConvergenceError(`${fallback}: mutation outcome unknown`, {
      cause: error,
    });
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new GsapPreviewConvergenceError(readMutationError(body, fallback));
  }
  return readMutationStatus(body);
}
