export interface UnsafeMutationValue {
  path: string;
  reason: "non-finite-number" | "null";
}

interface FindUnsafeMutationValuesOptions {
  allowNullPath?: (path: string) => boolean;
}

export function findUnsafeMutationValues(
  value: unknown,
  path = "body",
  options: FindUnsafeMutationValuesOptions = {},
): UnsafeMutationValue[] {
  if (value === null) {
    return options.allowNullPath?.(path) ? [] : [{ path, reason: "null" }];
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? [] : [{ path, reason: "non-finite-number" }];
  }
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findUnsafeMutationValues(item, `${path}[${index}]`, options),
    );
  }
  return Object.entries(value).flatMap(([key, item]) =>
    findUnsafeMutationValues(item, `${path}.${key}`, options),
  );
}

const DOM_PATCH_NULL_VALUE_PATH = /^body\.operations\[\d+\]\.value$/;

export function findUnsafeDomPatchValues(value: unknown): UnsafeMutationValue[] {
  return findUnsafeMutationValues(value, "body", {
    allowNullPath: (path) => DOM_PATCH_NULL_VALUE_PATH.test(path),
  });
}
