import { formatTimelineAttributeNumber } from "../player/components/timelineEditing";
import type { IframeWindow } from "../player/lib/playbackTypes";
import { furthestClipEndFromDocument } from "../player/lib/timelineElementHelpers";
import { readDocumentRootDuration, readRootCompositionDuration } from "../utils/rootDuration";
import { roundToCenti } from "../utils/rounding";
import type { RecordEditInput } from "../utils/studioFileHistory";
import { resolveRootLength, type ContentEnd } from "../utils/timelineAssetDrop";

export function patchDocumentRootDuration(
  doc: Document | null | undefined,
  contentEnd: number,
): boolean {
  if (!doc || !Number.isFinite(contentEnd) || contentEnd <= 0) return false;
  const nodes = Array.from(doc.querySelectorAll("[data-composition-id]"));
  const root =
    nodes.find((node) => !node.parentElement?.closest("[data-composition-id]")) ?? nodes[0] ?? null;
  if (!root) return false;
  root.setAttribute("data-duration", formatTimelineAttributeNumber(contentEnd));
  return true;
}

export function readLiveAnimationEnd(iframe: HTMLIFrameElement | null): number {
  try {
    const win = iframe?.contentWindow as IframeWindow | null | undefined;
    const end = win?.__hf?.animationEnd?.();
    return typeof end === "number" && Number.isFinite(end) && end > 0 ? end : 0;
  } catch {
    return 0;
  }
}

export function isPreviewedFile(path: string, activeCompPath: string | null): boolean {
  return path === (activeCompPath || "index.html");
}

export function animationEndFor(
  iframe: HTMLIFrameElement | null,
  path: string,
  activeCompPath: string | null,
): number {
  return isPreviewedFile(path, activeCompPath) ? readLiveAnimationEnd(iframe) : 0;
}

export type LengthAfterEdit = ((after?: ContentEnd) => number | null) & {
  isOwnLength: (length: number | null, path: string) => boolean;
};

type RecordEdit = (edit: RecordEditInput) => Promise<void>;

export function captureLiveLength(
  iframe: HTMLIFrameElement | null,
  recordEdit: RecordEdit,
): [LengthAfterEdit, RecordEdit] {
  const length = readDocumentRootDuration(iframe?.contentDocument);
  const before = liveContentEnd(iframe);
  const firstDecision: Array<number | null> = [];
  let firstWrite: RecordEditInput["files"] | undefined;
  const decide = (after = liveContentEnd(iframe)) => {
    const next = resolveRootLength(length, before, after);
    if (firstDecision.length === 0) firstDecision.push(next ?? length);
    return next;
  };
  const centi = (value: number | null) => (value == null ? null : roundToCenti(value));
  const isOwnLength = (onDisk: number | null, path: string) => {
    const file = firstWrite?.[path];
    const own = file ? [...firstDecision, readRootCompositionDuration(file.before)] : firstDecision;
    return own.some((value) => centi(value) === centi(onDisk));
  };
  const record: RecordEdit = (edit) => {
    firstWrite ??= edit.files;
    return recordEdit(edit);
  };
  return [Object.assign(decide, { isOwnLength }), record];
}

function liveContentEnd(iframe: HTMLIFrameElement | null): ContentEnd {
  return {
    clips: furthestClipEndFromDocument(iframe?.contentDocument),
    animation: readLiveAnimationEnd(iframe),
  };
}
