import { StudioSaveHttpError, trackStudioSaveFailure } from "../utils/studioSaveDiagnostics";
import type { DomEditPatchBatch } from "./domEditCommitTypes";
import { formatFieldsSuffix } from "./gsapScriptCommitHelpers";

export function formatUnsafeFieldList(fields: Array<{ path: string }>): string {
  return fields.map((field) => field.path).join(", ");
}

export function getErrorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function readErrorResponseBody(
  response: Response,
): Promise<{ error?: string; fields?: string[] } | null> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return null;
  return (await response.json().catch(() => null)) as { error?: string; fields?: string[] } | null;
}

export function formatPatchRejectionMessage(
  body: { error?: string; fields?: string[] } | null,
): string {
  if (!body?.error) return "Couldn't save edit";
  return `Couldn't save edit: ${body.error}${formatFieldsSuffix(body.fields)}`;
}

/** Human-readable identifier for a batch patch target (for the unmatched warning). */
function describeBatchPatchTarget(patch: DomEditPatchBatch["patches"][number]): string {
  return patch.target.id ?? patch.target.hfId ?? patch.target.selector ?? "(unaddressed)";
}

/**
 * Surface server-reported unmatched patches. The server atomically refuses the
 * whole multi-file gesture; the caller uses `durable: false` to roll back and
 * reload, so report the refusal without turning it into a second failure.
 */
function reportUnmatchedBatchPatches(batch: DomEditPatchBatch, matched: boolean[]): void {
  const unmatchedIds = batch.patches
    .filter((_, index) => matched[index] === false)
    .map(describeBatchPatchTarget);
  if (unmatchedIds.length === 0) return;
  console.warn(
    `[studio] z-index reorder: server could not match ${unmatchedIds.length} patch target(s) in ` +
      `${batch.sourceFile} (the whole z-order gesture will revert on reload):`,
    unmatchedIds.join(", "),
  );
  trackStudioSaveFailure({
    source: "dom_edit",
    error: new Error(`Batch patch target(s) unmatched: ${unmatchedIds.join(", ")}`),
    filePath: batch.sourceFile,
    mutationType: "z-reorder-unmatched",
  });
}

interface AtomicElementPatchFile {
  sourceFile: string;
  changed: boolean;
  matched?: boolean[];
  before: string;
  after: string;
}

export class AtomicElementPatchConvergenceError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AtomicElementPatchConvergenceError";
  }
}

// Keep the atomic response contract in one guard so callers do not compose validity.
// fallow-ignore-next-line complexity
function isAtomicElementPatchFile(value: unknown): value is AtomicElementPatchFile {
  return (
    typeof value === "object" &&
    value !== null &&
    "sourceFile" in value &&
    typeof value.sourceFile === "string" &&
    "changed" in value &&
    typeof value.changed === "boolean" &&
    (!("matched" in value) ||
      (Array.isArray(value.matched) &&
        value.matched.every((matched) => typeof matched === "boolean"))) &&
    "before" in value &&
    typeof value.before === "string" &&
    "after" in value &&
    typeof value.after === "string" &&
    value.changed === (value.before !== value.after)
  );
}

// This is the single client owner for dispatching and validating the aggregate
// atomic endpoint. Splitting validation from the request would weaken that wire contract.
// fallow-ignore-next-line complexity
export async function patchElementBatches(projectId: string, batches: DomEditPatchBatch[]) {
  const body = JSON.stringify({ batches });
  try {
    const response = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/file-mutations/patch-element-batches`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      },
    );
    if (!response.ok) {
      const rejection = await readErrorResponseBody(response);
      throw new StudioSaveHttpError(formatPatchRejectionMessage(rejection), response.status);
    }
    const result: unknown = await response.json().catch(() => null);
    if (
      typeof result !== "object" ||
      result === null ||
      !("durable" in result) ||
      typeof result.durable !== "boolean" ||
      !("files" in result) ||
      !Array.isArray(result.files) ||
      result.files.length !== batches.length ||
      !result.files.every(isAtomicElementPatchFile) ||
      (!result.durable && result.files.some((file) => file.changed))
    ) {
      throw new StudioSaveHttpError("Invalid atomic element patch response", 502);
    }
    const files = result.files.map((file, index) => {
      const batch = batches[index];
      const matched = file.matched ?? [];
      if (
        !batch ||
        file.sourceFile !== batch.sourceFile ||
        (matched.length !== 0 && matched.length !== batch.patches.length)
      ) {
        throw new StudioSaveHttpError("Invalid atomic element patch response", 502);
      }
      reportUnmatchedBatchPatches(batch, matched);
      return {
        ...file,
        matched,
        allMatched: matched.length === batch.patches.length && matched.every(Boolean),
      };
    });
    return { durable: result.durable, files };
  } catch (error) {
    throw new AtomicElementPatchConvergenceError(getErrorDetail(error), { cause: error });
  }
}

/**
 * A batch is reload-skippable only when it is style-only: every operation is an
 * `inline-style` write. The z-reorder commit applies those exact styles to the
 * live iframe DOM synchronously, so persisting them adds nothing the preview
 * doesn't already show. Any other op type (attribute / text-content / …) can
 * have server-side semantics the live DOM hasn't mirrored — reload for those.
 */
export function batchesAreInlineStyleOnly(batches: DomEditPatchBatch[]): boolean {
  return batches.every((batch) =>
    batch.patches.every((patch) => patch.operations.every((op) => op.type === "inline-style")),
  );
}
