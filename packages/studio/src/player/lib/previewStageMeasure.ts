// Validates and bounds `stage-measure` replies from the preview frame's editing port.
import {
  MAX_ELEMENT_TEXT,
  MAX_ELEMENT_VALUE,
  MAX_STAGE_CLIP_KEYS,
  MAX_STAGE_ITEMS,
  type StageMeasuredItem,
  type StageMeasureResult,
  type StageTextStart,
} from "@hyperframes/core/runtime/editing-port";
import { isMessageList } from "@hyperframes/core/runtime/protocol";
import { previewRequest, type ReadPriority } from "./previewChannel";

export {
  MAX_STAGE_CLIP_KEYS,
  MAX_STAGE_ITEMS,
  type StageMeasuredItem,
  type StageMeasureResult,
  type StageTextStart,
};

type Fields = Record<string, unknown>;

const isFields = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isBoundedText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length <= max;

const isShort = (value: unknown): value is string => isBoundedText(value, MAX_ELEMENT_VALUE);
const isNonEmptyShort = (value: unknown): value is string => isShort(value) && value.length > 0;
const isShortOrNull = (value: unknown): value is string | null => value === null || isShort(value);

const readRect = (value: unknown) => {
  if (!isFields(value)) return null;
  const { x, y, width, height } = value;
  if (![x, y, width, height].every((n): n is number => typeof n === "number" && Number.isFinite(n)))
    return null;
  return { x: x as number, y: y as number, width: width as number, height: height as number };
};

const readTextStart = (value: unknown): StageTextStart | null | undefined => {
  if (value === null) return null;
  if (!isFields(value)) return undefined;
  const { x, y } = value;
  if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y))
    return undefined;
  return { x, y };
};

const readClipKeys = (value: unknown): string[] | null => {
  if (!isMessageList(value, MAX_STAGE_CLIP_KEYS)) return null;
  if (!value.every(isNonEmptyShort)) return null;
  return [...value];
};

const hasBooleans = (value: Fields): boolean =>
  typeof value.placed === "boolean" &&
  typeof value.visible === "boolean" &&
  typeof value.hasElementChildren === "boolean" &&
  typeof value.hasBackgroundImage === "boolean";

const hasStrings = (value: Fields): boolean =>
  isNonEmptyShort(value.key) &&
  isShortOrNull(value.hfId) &&
  isShortOrNull(value.id) &&
  isNonEmptyShort(value.tag) &&
  isShortOrNull(value.parent) &&
  isBoundedText(value.text, MAX_ELEMENT_TEXT) &&
  isShort(value.fontSize) &&
  isShort(value.color) &&
  isShort(value.background);

export function readStageMeasuredItem(value: unknown): StageMeasuredItem | null {
  if (!isFields(value) || !hasStrings(value) || !hasBooleans(value)) return null;
  const box = readRect(value.box);
  const clipKeys = readClipKeys(value.clipKeys);
  const textStart = readTextStart(value.textStart);
  if (!box || !clipKeys || textStart === undefined) return null;
  return {
    key: value.key as string,
    hfId: value.hfId as string | null,
    id: value.id as string | null,
    tag: value.tag as string,
    parent: value.parent as string | null,
    text: value.text as string,
    box,
    fontSize: value.fontSize as string,
    color: value.color as string,
    background: value.background as string,
    placed: value.placed as boolean,
    visible: value.visible as boolean,
    clipKeys,
    hasElementChildren: value.hasElementChildren as boolean,
    textStart,
    hasBackgroundImage: value.hasBackgroundImage as boolean,
  };
}

export interface MeasurePreviewStageOptions {
  maxItems?: number;
  timeoutMs?: number;
  priority?: ReadPriority;
}

/** Reads the preview frame's stage snapshot over its editing port; null when unavailable or malformed. */
export async function measurePreviewStage(
  iframe: HTMLIFrameElement,
  options: MeasurePreviewStageOptions = {},
): Promise<StageMeasureResult | null> {
  const { maxItems, timeoutMs, priority = "now" } = options;
  if (
    maxItems !== undefined &&
    (!Number.isSafeInteger(maxItems) || maxItems < 1 || maxItems > MAX_STAGE_ITEMS)
  ) {
    return null;
  }
  const limit = maxItems ?? MAX_STAGE_ITEMS;
  const params = maxItems !== undefined ? { maxItems } : {};
  const reply: unknown = await previewRequest(iframe, "stage-measure", params, timeoutMs, priority);
  if (
    !isFields(reply) ||
    typeof reply.truncated !== "boolean" ||
    !isMessageList(reply.items, limit)
  ) {
    return null;
  }
  const items: StageMeasuredItem[] = [];
  for (const entry of reply.items) {
    const item = readStageMeasuredItem(entry);
    if (!item) return null;
    items.push(item);
  }
  return { items, truncated: reply.truncated };
}
