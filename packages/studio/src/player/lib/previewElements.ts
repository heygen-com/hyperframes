/**
 * Elements of a preview frame Studio cannot script, by the handles its runtime gives them. A handle
 * names an element for one load of the frame; after the frame loads again, describe it afresh.
 */
import {
  EDITING_ELEMENT_HANDLE,
  MAX_DESCRIBE_HANDLES,
  type EditingElementDescription,
  type EditingElementHit,
  type EditingElementSource,
} from "@hyperframes/core/runtime/editing-port";
import { resolveElementSourceFile } from "../../components/editor/domEditingDom";
import { previewRequest } from "./previewChannel";

declare const checked: unique symbol;
/** A description that passed `readPreviewElement`. Only that function makes one. */
export type PreviewElement = EditingElementDescription & { readonly [checked]: true };
export type PreviewElementHit = EditingElementHit & { readonly [checked]: true };

type Fields = Record<string, unknown>;
const isFields = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isHandle = (value: unknown) =>
  typeof value === "string" && EDITING_ELEMENT_HANDLE.test(value);
const isText = (value: unknown) => typeof value === "string";
const isTextOrNull = (value: unknown) => value === null || typeof value === "string";
const isCount = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;

const isSource = (value: unknown): value is EditingElementSource =>
  isFields(value) &&
  isTextOrNull(value.file) &&
  isTextOrNull(value.compositionId) &&
  isTextOrNull(value.originalCompositionId);

const isTextRecord = (value: unknown) => isFields(value) && Object.values(value).every(isText);

function hasPlainFields(value: Fields): boolean {
  const { matchesBefore, attributes, children } = value;
  const groupsOk =
    matchesBefore === null ||
    (Array.isArray(matchesBefore) &&
      matchesBefore.every((g) => isFields(g) && isSource(g.source) && isCount(g.count)));
  const attributesOk =
    Array.isArray(attributes) &&
    attributes.every((a) => Array.isArray(a) && a.length === 2 && a.every(isText));
  const childrenOk =
    Array.isArray(children) &&
    children.every((c) => isFields(c) && (isHandle(c.handle) || isText(c.text)));
  return groupsOk && attributesOk && childrenOk && typeof value.truncated === "boolean";
}

function readHit(value: unknown): PreviewElementHit | null {
  if (!isFields(value) || !isHandle(value.handle) || !isText(value.tag)) return null;
  const { rect } = value;
  const rectOk = isFields(rect) && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite);
  return rectOk ? (value as unknown as PreviewElementHit) : null;
}

/** Frame data checked against `EditingElementDescription`; null when any field is off. */
export function readPreviewElement(value: unknown): PreviewElement | null {
  if (!readHit(value) || !isFields(value)) return null;
  if (value.parent !== null && !isHandle(value.parent)) return null;
  if (!isTextOrNull(value.id) || !isTextOrNull(value.selector)) return null;
  if (!isSource(value.source) || typeof value.locked !== "boolean") return null;
  if (!isTextRecord(value.inlineStyles) || !isText(value.text)) return null;
  return hasPlainFields(value) ? (value as unknown as PreviewElement) : null;
}

/** The elements under a frame viewport point, topmost first; null when the runtime cannot answer. */
export async function previewElementsAtPoint(
  iframe: HTMLIFrameElement,
  x: number,
  y: number,
): Promise<PreviewElementHit[] | null> {
  const reply = await previewRequest(iframe, "elements-at-point", { x, y });
  const elements: unknown = reply?.elements;
  if (!Array.isArray(elements)) return null;
  return elements.map(readHit).filter((element) => element !== null);
}

/**
 * One entry per handle, in order: null for an element the frame no longer has. The whole answer is
 * null when the runtime cannot answer, or when there are no handles or more than the runtime takes.
 */
export async function describePreviewElements(
  iframe: HTMLIFrameElement,
  handles: readonly string[],
): Promise<Array<PreviewElement | null> | null> {
  if (!handles.length || handles.length > MAX_DESCRIBE_HANDLES) return null;
  const reply = await previewRequest(iframe, "describe", { handles: [...handles] });
  const elements: unknown = reply?.elements;
  if (!Array.isArray(elements) || elements.length !== handles.length) return null;
  return elements.map((entry, index) => {
    const element = readPreviewElement(entry);
    return element?.handle === handles[index] ? element : null;
  });
}

/** `getSourceFileForElement` for the frame's own element. */
export function previewElementSourceFile(
  element: PreviewElement,
  activeCompositionPath: string | null,
): string {
  return resolveElementSourceFile(element.source, activeCompositionPath);
}

/** `getSelectorIndex` for the frame's own element; undefined when the runtime could not count. */
export function previewElementSelectorIndex(
  element: PreviewElement,
  activeCompositionPath: string | null,
): number | undefined {
  if (!element.selector?.startsWith(".") || !element.matchesBefore) return undefined;
  const file = previewElementSourceFile(element, activeCompositionPath);
  return element.matchesBefore
    .filter((group) => resolveElementSourceFile(group.source, activeCompositionPath) === file)
    .reduce((sum, group) => sum + group.count, 0);
}
