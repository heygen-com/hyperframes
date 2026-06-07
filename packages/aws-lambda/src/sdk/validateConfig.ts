/**
 * Client-side validation for the AWS Lambda adapter.
 *
 * The cloud-agnostic config-shape validation (`validateDistributedRenderConfig`,
 * `validateVariablesPayload`, `InvalidConfigError`) lives in
 * `@hyperframes/producer/distributed` and is shared with the other adapters.
 * This module re-exports those and adds the one piece specific to Step
 * Functions: the 256 KiB Standard-workflow execution-input size cap.
 */

import { InvalidConfigError } from "@hyperframes/producer/distributed";

export {
  InvalidConfigError,
  validateDistributedRenderConfig,
  validateVariablesPayload,
} from "@hyperframes/producer/distributed";

/**
 * Hard cap on Step Functions Standard workflow execution input — 256 KiB per
 * the AWS limits page. Express workflows cap at 32 KiB; the render stack runs
 * Standard for execution-history visibility, so the larger limit applies. The
 * cap is on the entire serialized input, not just the variables, because
 * users hit it at the wire boundary regardless of which field caused the
 * bloat.
 *
 * Specific to Step Functions Standard. Other workflow runtimes (Temporal,
 * Express SFN, Cloud Workflows, raw Lambda invoke) have different caps; don't
 * reuse this constant for those without confirming the limit.
 */
export const MAX_STEP_FUNCTIONS_INPUT_BYTES = 256 * 1024;

/** Pointer to the docs section that explains the URL-your-assets convention. */
const LARGE_VARIABLES_DOCS_URL =
  "https://hyperframes.heygen.com/deploy/templates-on-lambda#working-with-large-variables";

/**
 * Validate that the serialized Step Functions execution input fits inside the
 * 256 KiB Standard-workflow cap. Measured in UTF-8 bytes (the format Step
 * Functions uses on the wire) — JS strings count UTF-16 code units, which
 * under-reports for any multi-byte character.
 *
 * Throws {@link InvalidConfigError} with a clear message naming the actual
 * byte count, the cap, and a pointer to the "working with large variables"
 * docs section, so users hit the limit at the SDK boundary with actionable
 * guidance instead of as a `States.DataLimitExceeded` 50 ms into the
 * execution.
 */
// fallow-ignore-next-line complexity
export function validateStepFunctionsInputSize(input: unknown): void {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(input);
  } catch (err) {
    throw new InvalidConfigError(
      "config",
      `Step Functions execution input is not JSON-serializable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (serialized === undefined) {
    throw new InvalidConfigError(
      "config",
      "Step Functions execution input is not JSON-serializable (JSON.stringify returned undefined). " +
        "Check that all fields, including config.variables, are plain JSON values.",
    );
  }
  const byteLength = Buffer.byteLength(serialized, "utf8");
  if (byteLength > MAX_STEP_FUNCTIONS_INPUT_BYTES) {
    throw new InvalidConfigError(
      "config",
      `Step Functions execution input is ${byteLength} bytes, which exceeds the ` +
        `${MAX_STEP_FUNCTIONS_INPUT_BYTES}-byte (256 KiB) limit for Standard workflows. ` +
        `Variables are for typed data (strings, numbers, structured records); media assets ` +
        `(images, audio, video) should be passed as URL references the composition resolves ` +
        `at render time, not inlined as base64. See ${LARGE_VARIABLES_DOCS_URL} for the ` +
        `URL-your-assets convention.`,
    );
  }
}
