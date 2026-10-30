import {
  RenderQualityError,
  extractSafeRenderErrorCode,
  type RenderJob,
} from "@hyperframes/producer";
import { CaptureFailure, audioFailureDiagnostics } from "@hyperframes/engine";

const FILE_ERRORS = [
  "ENOENT",
  "EPERM",
  "EACCES",
  "EBUSY",
  "ENOSPC",
  "EMFILE",
  "EISDIR",
  "ENOTDIR",
  "EEXIST",
  "EXDEV",
];
const FILE_ERROR = new RegExp(`\\b(${FILE_ERRORS.join("|")})\\b`);

function fileErrorOf(error: unknown, message: string): string | undefined {
  let seen: unknown = error;
  for (let depth = 0; depth < 5 && seen instanceof Error; depth++) {
    const code = (seen as NodeJS.ErrnoException).code;
    if (code && FILE_ERRORS.includes(code)) return code;
    seen = seen.cause;
  }
  return FILE_ERROR.exec(message)?.[1];
}

function producerCodeOf(error: unknown): string | undefined {
  let seen: unknown = error;
  for (let depth = 0; depth < 5 && seen instanceof Error; depth++) {
    const code = extractSafeRenderErrorCode(seen);
    if (code) return code;
    seen = seen.cause;
  }
  return undefined;
}

function captureCodeOf(error: unknown, message: string): string | undefined {
  if (/Composition has zero duration/.test(message)) return "COMPOSITION_ZERO_DURATION";
  if (!(error instanceof CaptureFailure)) return undefined;
  return error.pageErrorLines.length > 0 ? "PAGE_ERROR" : `CAPTURE_${error.kind.toUpperCase()}`;
}

/** A failed render's code: never its words, which can name the person's files and folders. */
function renderFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof RenderQualityError && error.warnings[0])
    return error.warnings[0].code.toUpperCase();
  return (
    producerCodeOf(error) ??
    fileErrorOf(error, message) ??
    captureCodeOf(error, message) ??
    "RENDER_FAILED"
  );
}

/** Versioned, content-free failure line for Desktop's piped CLI, separate from human error output. */
export function renderMachineDiagnostic(values: readonly unknown[], code?: string): void {
  if (process.stdout.isTTY || process.env.HYPERFRAMES_STDOUT_IS_TTY === "1") return;
  const failures = audioFailureDiagnostics(values);
  if (failures.length === 0 && !code) return;
  const line = {
    version: 1,
    operation: "render",
    ...(code ? { code } : {}),
    ...(failures.length > 0 ? { audioFailures: failures } : {}),
  };
  process.stdout.write(`@hf-diagnostic ${JSON.stringify(line)}\n`);
}

export function renderFailureDiagnostic(
  job: RenderJob | undefined,
  error: unknown,
  quiet: boolean,
): void {
  if (quiet) return;
  const interruptedFailures =
    error !== null &&
    typeof error === "object" &&
    "audioFailures" in error &&
    Array.isArray(error.audioFailures)
      ? error.audioFailures
      : [];
  renderMachineDiagnostic(
    [
      ...interruptedFailures,
      ...(job?.warnings.flatMap((warning) => warning.details?.audioFailures ?? []) ?? []),
    ],
    renderFailureCode(error),
  );
}
