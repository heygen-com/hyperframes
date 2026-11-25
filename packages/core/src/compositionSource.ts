export const COMPOSITION_SRC_ATTR = "data-composition-src";

export const CODE_LOADING_ATTRS: ReadonlySet<string> = new Set([COMPOSITION_SRC_ATTR]);

export const SOURCE_HOST_ATTRS = ["data-composition-file", COMPOSITION_SRC_ATTR] as const;
export const COMPOSITION_ROOT_ATTRS = [
  "data-composition-id",
  "data-hf-original-composition-id",
] as const;
