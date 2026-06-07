/**
 * Client-side validation for the Cloud Run adapter.
 *
 * The cloud-agnostic config-shape validation (`validateDistributedRenderConfig`,
 * `validateVariablesPayload`, `InvalidConfigError`) lives in
 * `@hyperframes/producer/distributed` and is shared with the other adapters.
 * This module re-exports those and adds the one piece that is specific to
 * Cloud Workflows: the 512 KiB execution-argument size cap.
 */

import { InvalidConfigError } from "@hyperframes/producer/distributed";

export {
  InvalidConfigError,
  validateDistributedRenderConfig,
  validateVariablesPayload,
} from "@hyperframes/producer/distributed";

/**
 * Hard cap on Cloud Workflows execution arguments — 512 KiB per the Workflows
 * quotas page (maximum size of arguments passed when an execution starts).
 * The cap is on the entire serialized argument, not just the variables,
 * because users hit it at the wire boundary regardless of which field caused
 * the bloat.
 *
 * Specific to Cloud Workflows. Other runtimes (Lambda + Step Functions,
 * Temporal) have different caps; don't reuse this constant for those without
 * confirming the limit.
 */
export const MAX_WORKFLOWS_INPUT_BYTES = 512 * 1024;

/** Pointer to the docs section that explains the URL-your-assets convention. */
const LARGE_VARIABLES_DOCS_URL =
  "https://hyperframes.heygen.com/deploy/templates-on-lambda#working-with-large-variables";

/**
 * Validate that the serialized Cloud Workflows execution argument fits inside
 * the 512 KiB cap. Measured in UTF-8 bytes (the format the API uses on the
 * wire) — JS strings count UTF-16 code units, which under-reports for any
 * multi-byte character.
 *
 * Throws {@link InvalidConfigError} with a clear message naming the actual
 * byte count, the cap, and a pointer to the "working with large variables"
 * docs section, so users hit the limit at the SDK boundary with actionable
 * guidance instead of as an opaque argument-too-large error after the
 * execution starts.
 */
// fallow-ignore-next-line complexity
export function validateWorkflowsInputSize(input: unknown): void {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(input);
  } catch (err) {
    throw new InvalidConfigError(
      "config",
      `Cloud Workflows execution argument is not JSON-serializable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (serialized === undefined) {
    throw new InvalidConfigError(
      "config",
      "Cloud Workflows execution argument is not JSON-serializable (JSON.stringify returned undefined). " +
        "Check that all fields, including config.variables, are plain JSON values.",
    );
  }
  const byteLength = Buffer.byteLength(serialized, "utf8");
  if (byteLength > MAX_WORKFLOWS_INPUT_BYTES) {
    throw new InvalidConfigError(
      "config",
      `Cloud Workflows execution argument is ${byteLength} bytes, which exceeds the ` +
        `${MAX_WORKFLOWS_INPUT_BYTES}-byte (512 KiB) limit. Variables are for typed data ` +
        `(strings, numbers, structured records); media assets (images, audio, video) should ` +
        `be passed as URL references the composition resolves at render time, not inlined as ` +
        `base64. See ${LARGE_VARIABLES_DOCS_URL} for the URL-your-assets convention.`,
    );
  }
}
