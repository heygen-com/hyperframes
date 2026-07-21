/**
 * Plan-time validators for the distributed render pipeline. Each validator
 * is invoked before freezing the plan, so banned configurations fail fast
 * with a typed non-retryable error instead of being baked into a planDir
 * and only surfacing on the chunk worker.
 */

import { BROWSER_GPU_NOT_SOFTWARE } from "@hyperframes/engine";
import {
  collectFontFamilyCustomProperties,
  GENERIC_FAMILIES,
  iterateFontFamilyDeclarations,
  resolveFontFamilyDeclarationFamilies,
} from "../deterministicFonts.js";

/**
 * Re-export the BROWSER_GPU_NOT_SOFTWARE code so distributed adapters and
 * Step Functions / Temporal retry policies can match it without a
 * cross-package import.
 */
export { BROWSER_GPU_NOT_SOFTWARE } from "@hyperframes/engine";

/**
 * Re-export the shared font-family parser. The plan-time validator and the
 * @font-face injector consume the same surface, so the parser lives next to
 * the data.
 */
export { parseFontFamilyValue } from "../deterministicFonts.js";

/**
 * Typed plan-validation error. Workflow adapters key retry policies off the
 * `code` field to mark errors as non-retryable.
 */
export class PlanValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PlanValidationError";
    this.code = code;
  }
}

/**
 * Subset of the merged plan / engine / render config that the GPU validator
 * inspects. Both `useGpu` (RenderConfig) and `browserGpuMode` (EngineConfig)
 * are optional so callers can pass any of the surrounding config shapes
 * without an adapter layer.
 *
 *   - `useGpu === true` → encoder GPU acceleration (NVENC/QSV/VAAPI). Banned
 *     because GPU encoders produce non-byte-identical output across machines.
 *   - `browserGpuMode !== "software"` → headless Chrome's WebGL is allowed
 *     to use hardware GL. Banned because hardware GL is bitwise unstable
 *     across drivers. Pairs with the runtime `assertSwiftShader` check that
 *     catches workers whose environment ignores Chrome's `--use-gl=swiftshader`.
 */
export interface ValidateNoGpuEncodeInput {
  useGpu?: boolean;
  browserGpuMode?: string;
}

/**
 * Typed code for {@link validateNoSystemFonts}. Distributed chunk workers
 * render in a Linux container without host-OS fonts; compositions declaring
 * `-apple-system` / `system-ui` as a primary family would render differently
 * on the worker, breaking byte-identical retries.
 */
export const SYSTEM_FONT_USED = "SYSTEM_FONT_USED";

/** Typed code for invalid duration metadata resolved by the shared browser probe. */
export const DISTRIBUTED_DURATION_OUT_OF_RANGE = "DISTRIBUTED_DURATION_OUT_OF_RANGE";
/** Generic alias; the legacy value remains stable for workflow retry policies. */
export const RENDER_DURATION_OUT_OF_RANGE = DISTRIBUTED_DURATION_OUT_OF_RANGE;

/** All render paths are operationally bounded to one day of output. */
export const MAX_DISTRIBUTED_DURATION_SECONDS = 24 * 60 * 60;
/** Generic alias retained alongside the distributed public API. */
export const MAX_RENDER_DURATION_SECONDS = MAX_DISTRIBUTED_DURATION_SECONDS;

/**
 * Reject any config that would let GPU encode or hardware-GL slip into a
 * distributed render. Throws {@link PlanValidationError} with
 * `code === BROWSER_GPU_NOT_SOFTWARE` when either gate trips. The message
 * names the offending field so the caller can surface a clean error.
 */
export function validateNoGpuEncode(config: ValidateNoGpuEncodeInput): void {
  if (config.useGpu === true) {
    throw new PlanValidationError(
      BROWSER_GPU_NOT_SOFTWARE,
      "[planValidation] GPU encode is banned in distributed mode: " +
        "config.useGpu === true. " +
        "Distributed retries must be byte-identical, but NVENC/QSV/VAAPI " +
        "produce different output across machines. Set useGpu=false (the " +
        "default) — software libx264/libx265 is the only supported encoder " +
        "in distributed mode.",
    );
  }
  if (config.browserGpuMode !== undefined && config.browserGpuMode !== "software") {
    throw new PlanValidationError(
      BROWSER_GPU_NOT_SOFTWARE,
      `[planValidation] Hardware browser GPU is banned in distributed mode: ` +
        `config.browserGpuMode === ${JSON.stringify(config.browserGpuMode)}. ` +
        `Hardware GL is bitwise unstable across drivers. Set browserGpuMode="software" ` +
        `so Chrome launches with --use-gl=swiftshader.`,
    );
  }
}

/**
 * Reject a compiled HTML document whose top-priority font-family resolves to
 * a host-OS / generic family. Throws {@link PlanValidationError} with
 * `code === SYSTEM_FONT_USED` and the offending family in the message.
 *
 * Inspects the FIRST entry of each font-family declaration: that's the
 * family the browser tries to use. Subsequent entries are CSS fallbacks,
 * and a generic fallback is fine and conventional — so
 * `font-family: "Inter", -apple-system, sans-serif` passes and
 * `font-family: -apple-system, BlinkMacSystemFont, "Segoe UI"` fails.
 *
 * Reads font-family surfaces via `iterateFontFamilyDeclarations` so the
 * @font-face injector and this validator scan the same regions.
 */
export function validateNoSystemFonts(compiledHtml: string): void {
  const customProperties = collectFontFamilyCustomProperties(compiledHtml);
  for (const { surface, declaration } of iterateFontFamilyDeclarations(compiledHtml)) {
    const families = resolveFontFamilyDeclarationFamilies(declaration, customProperties);
    if (families.length === 0) continue;
    const primaryRaw = families[0]!;
    // Unresolved var() primaries are left to the browser; resolved custom
    // properties are checked above so common `--font: system-ui` aliases fail.
    if (!GENERIC_FAMILIES.has(primaryRaw.toLowerCase())) continue;
    throw new PlanValidationError(
      SYSTEM_FONT_USED,
      `[planValidation] Composition declares a host-OS / generic primary ${surface}: ` +
        `${JSON.stringify(primaryRaw)} (full declaration: ${JSON.stringify(declaration.trim())}). ` +
        `Distributed chunk workers render in a Linux container and cannot produce byte-identical ` +
        `output for fonts that resolve to host system installations. Use a deterministic web font ` +
        `(e.g. Inter, Montserrat, or another @fontsource family) as the primary family; generic ` +
        `names like "sans-serif" / "-apple-system" / "system-ui" are only allowed as fallbacks.`,
    );
  }
}

export function validateRenderDuration(input: {
  duration: number;
  totalFrames: number;
  fps: number;
}): void {
  const { duration, totalFrames, fps } = input;
  const maxFrames = Math.ceil(MAX_RENDER_DURATION_SECONDS * fps);
  if (
    Number.isFinite(duration) &&
    duration > 0 &&
    Number.isFinite(fps) &&
    fps > 0 &&
    Number.isSafeInteger(totalFrames) &&
    totalFrames > 0 &&
    totalFrames <= maxFrames
  ) {
    return;
  }

  throw new PlanValidationError(
    RENDER_DURATION_OUT_OF_RANGE,
    `[planValidation] Render duration is out of range: ` +
      `duration=${String(duration)}s totalFrames=${String(totalFrames)} fps=${String(fps)} ` +
      `(maxDuration=${String(MAX_RENDER_DURATION_SECONDS)}s, maxFrames=${String(maxFrames)}). ` +
      `This usually means an unbounded timeline escaped into render planning, such as ` +
      `GSAP repeat:-1 / yoyo loops without an explicit finite root duration. Add a finite ` +
      `data-duration or replace infinite repeats with a finite repeat count before rendering.`,
  );
}

/** Backward-compatible distributed entry point for existing adopters. */
export function validateDistributedDuration(input: {
  duration: number;
  totalFrames: number;
  fps: number;
}): void {
  validateRenderDuration(input);
}
