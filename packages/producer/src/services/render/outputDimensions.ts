export interface ExpectedOutputDimensions {
  width: number;
  height: number;
}

export function isExpectedOutputDimensions(value: unknown): value is ExpectedOutputDimensions {
  return (
    typeof value === "object" &&
    value !== null &&
    "width" in value &&
    "height" in value &&
    typeof value.width === "number" &&
    typeof value.height === "number" &&
    Number.isSafeInteger(value.width) &&
    Number.isSafeInteger(value.height) &&
    value.width > 0 &&
    value.height > 0
  );
}

class OutputDimensionsMismatchError extends Error {
  readonly code = "OUTPUT_DIMENSIONS_MISMATCH";

  constructor() {
    super("Compiled output dimensions do not match the requested render dimensions.");
  }
}

export function requireOutputDimensions(
  expected: ExpectedOutputDimensions | undefined,
  width: number,
  height: number,
): void {
  if (
    expected !== undefined &&
    (!isExpectedOutputDimensions(expected) ||
      expected.width !== width ||
      expected.height !== height)
  ) {
    throw new OutputDimensionsMismatchError();
  }
}
