import { TELEMETRY_OPT_OUT_VALUES } from "../cli/src/media-use/lib/telemetry-opt-out.mjs";

/** The opt-out spellings Studio's browser code compares its build flag against. */
export const TELEMETRY_OPT_OUT_DEFINE = {
  __HF_TELEMETRY_OPT_OUT_VALUES__: JSON.stringify(TELEMETRY_OPT_OUT_VALUES),
};
