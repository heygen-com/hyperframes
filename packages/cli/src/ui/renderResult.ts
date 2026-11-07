import {
  REFERENCE_BACKGROUND_FIELD,
  referenceBackgroundResult,
  type ReferenceBackgroundResult,
} from "@hyperframes/producer";

/** Versioned, content-free success line for a piped CLI: the background the render measured, never a path or a word of the composition. */
export function renderMachineResult(
  result: Partial<ReferenceBackgroundResult>,
  quiet: boolean,
): void {
  if (quiet || process.stdout.isTTY || process.env.HYPERFRAMES_STDOUT_IS_TTY === "1") return;
  if (!(REFERENCE_BACKGROUND_FIELD in result)) return;
  const line = {
    version: 1,
    operation: "render",
    ...referenceBackgroundResult(result[REFERENCE_BACKGROUND_FIELD]),
  };
  process.stdout.write(`@hf-result ${JSON.stringify(line)}\n`);
}
