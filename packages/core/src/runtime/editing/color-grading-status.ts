import type { HfColorGradingTarget } from "../../colorGrading";

/** The page's colour grading runtime as these kinds use it, declared here so the port does not pull
 *  runtime/colorGrading.ts into every build that imports it. */
interface GradingRuntime {
  getStatus(target: HfColorGradingTarget): GradingStatus;
  renderPreviews(
    target: HfColorGradingTarget,
    candidates: readonly GradingPreviewCandidate[],
    options: { maxDimension: number; useMediaTime: boolean },
  ): Promise<GradingPreviewBatch | null>;
  startPreviewPlayback(target: HfColorGradingTarget): (() => void) | null;
}
interface GradingStatus {
  state: "missing" | "inactive" | "pending" | "active" | "unavailable";
  message: string;
}
export interface GradingPreviewCandidate {
  id: string;
  grading: unknown;
}
export interface GradingPreviewBatch {
  width: number;
  height: number;
  images: Array<{ id: string; dataUrl: string | null; error?: string }>;
}

const MAX_TARGET_TEXT = 2_000;
const TARGET_KEYS = "hfId,id,selector,selectorIndex";

// editingPort.ts imports this file, so taking its isPlainRecord would make a cycle.
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  Object.prototype.toString.call(value) === "[object Object]";

/** The page's colour grading runtime, when it has one. */
export const gradingRuntime = (): GradingRuntime | undefined =>
  (Reflect.get(window, "__hf") as { colorGrading?: GradingRuntime } | undefined)?.colorGrading;

const isTargetText = (value: unknown) =>
  value === null || (typeof value === "string" && value.length <= MAX_TARGET_TEXT);

/** The media element a colour grading request names, in the shape Studio sends: every key, each nullable. */
export function colorGradingTarget(value: unknown): HfColorGradingTarget | null {
  if (!isRecord(value) || Object.keys(value).sort().join() !== TARGET_KEYS) return null;
  const { id, hfId, selector, selectorIndex } = value;
  const index =
    selectorIndex === null ||
    (Number.isSafeInteger(selectorIndex) && (selectorIndex as number) >= 0);
  return isTargetText(id) && isTargetText(hfId) && isTargetText(selector) && index
    ? (value as HfColorGradingTarget)
    : null;
}

/** The grading state of one media element; null when the page has no colour grading runtime. */
export type ColorGradingStatusRequest = {
  params: { target: HfColorGradingTarget };
  result: { status: GradingStatus | null };
};

export function parseColorGradingStatusParams(
  params: unknown,
): ColorGradingStatusRequest["params"] | null {
  if (!isRecord(params) || Object.keys(params).join() !== "target") return null;
  const target = colorGradingTarget(params.target);
  return target ? { target } : null;
}

export function colorGradingStatus({
  target,
}: ColorGradingStatusRequest["params"]): ColorGradingStatusRequest["result"] {
  return { status: gradingRuntime()?.getStatus(target) ?? null };
}
