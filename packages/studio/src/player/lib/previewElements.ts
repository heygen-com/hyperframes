/**
 * Elements of a preview frame Studio cannot script, by the handles its runtime gives them. A handle
 * names an element for one load of the frame; after the frame loads again, describe it afresh.
 */
import {
  EDITING_ELEMENT_HANDLE,
  MAX_DESCRIBE_HANDLES,
  MAX_ELEMENT_ENTRIES,
  MAX_ELEMENT_VALUE,
  MAX_GEOMETRY_CHILDREN,
  MAX_SNAP_TARGETS,
  type EditingElementBox,
  type EditingElementDescription,
  type EditingElementGeometry,
  type EditingGestureStart,
  type EditingElementHit,
  type EditingElementMatch,
  type EditingElementSource,
  type EditingLayer,
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

const isRect = (value: unknown) =>
  isFields(value) && [value.x, value.y, value.width, value.height].every(Number.isFinite);

function readHit(value: unknown): PreviewElementHit | null {
  if (!isFields(value) || !isHandle(value.handle) || !isText(value.tag)) return null;
  return isRect(value.rect) ? (value as unknown as PreviewElementHit) : null;
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

export async function previewPointerTargets(
  iframe: HTMLIFrameElement,
  rootFractionX: number,
  rootFractionY: number,
): Promise<{ target: PreviewElementHit | null; stack: PreviewElementHit[] } | null> {
  const params = { x: rootFractionX, y: rootFractionY };
  const reply = await previewRequest(iframe, "pointer-targets", params);
  const stack: unknown = reply?.stack;
  if (!reply || !Array.isArray(stack)) return null;
  return { target: readHit(reply.target), stack: stack.map(readHit).filter((hit) => hit !== null) };
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

/** Each handle's ancestors, parent first; null for an element the frame no longer has. */
export async function previewAncestors(
  iframe: HTMLIFrameElement,
  handles: readonly string[],
): Promise<Array<string[] | null> | null> {
  if (!handles.length || handles.length > MAX_DESCRIBE_HANDLES) return null;
  const reply = await previewRequest(iframe, "ancestors", { handles: [...handles] });
  const chains: unknown = reply?.ancestors;
  if (!Array.isArray(chains) || chains.length !== handles.length) return null;
  return chains.map((chain) =>
    Array.isArray(chain) && chain.every(isHandle) ? (chain as string[]) : null,
  );
}

/** The frame's matches for `selector` in document order; null when the runtime cannot answer. */
export async function queryPreviewElements(
  iframe: HTMLIFrameElement,
  selector: string,
): Promise<{ matches: EditingElementMatch[]; truncated: boolean } | null> {
  const reply = await previewRequest(iframe, "query", { selector });
  const matches: unknown = reply?.matches;
  if (!Array.isArray(matches) || typeof reply?.truncated !== "boolean") return null;
  const ok = matches.every((m) => isFields(m) && isHandle(m.handle) && isSource(m.source));
  return ok ? { matches: matches as EditingElementMatch[], truncated: reply.truncated } : null;
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

const isPoint = (value: unknown) =>
  isFields(value) && Number.isFinite(value.x) && Number.isFinite(value.y);
const isSizeOrNull = (value: unknown) =>
  value === null || (Number.isFinite(value) && (value as number) > 0);

const CORNERS = ["nw", "ne", "se", "sw"] as const;
const isCorners = (value: unknown) =>
  value === null || (isFields(value) && CORNERS.every((corner) => isPoint(value[corner])));

const isSourceBox = (value: unknown) =>
  value === null ||
  (isFields(value) &&
    Number.isFinite(value.width) &&
    Number.isFinite(value.height) &&
    isSizeOrNull(value.declaredWidth) &&
    isSizeOrNull(value.declaredHeight));

const isClipPath = (value: unknown) =>
  value === null || (isText(value) && (value as string).length <= MAX_ELEMENT_VALUE);

const isBox = (value: unknown): value is EditingElementBox =>
  isFields(value) &&
  isRect(value.rect) &&
  Number.isFinite(value.angle) &&
  isCorners(value.corners) &&
  isSourceBox(value.source) &&
  isClipPath(value.clipPath);

const readGeometry = (value: unknown): EditingElementGeometry | null => {
  if (!isBox(value) || !isFields(value) || typeof value.visible !== "boolean") return null;
  const { members } = value;
  const membersOk =
    members === null ||
    (Array.isArray(members) && members.length <= MAX_ELEMENT_ENTRIES && members.every(isRect));
  return membersOk ? (value as unknown as EditingElementGeometry) : null;
};

export interface PreviewGeometry {
  /** One entry per handle, in order: null for an element the frame no longer has. */
  elements: Array<EditingElementGeometry | null>;
  /** The `children` element's descendants, when it has 1 to MAX_GEOMETRY_CHILDREN; else empty. */
  children: EditingElementBox[] | null;
}

/** Overlay geometry for `handles`, and `children`'s descendant boxes; null when the runtime cannot answer. */
export async function previewGeometry(
  iframe: HTMLIFrameElement,
  handles: readonly string[],
  children?: string,
): Promise<PreviewGeometry | null> {
  if (!handles.length || handles.length > MAX_DESCRIBE_HANDLES) return null;
  const params = { handles: [...handles], ...(children ? { children } : {}) };
  const reply = await previewRequest(iframe, "geometry", params);
  const elements: unknown = reply?.elements;
  if (!Array.isArray(elements) || elements.length !== handles.length) return null;
  const boxes: unknown = reply?.children;
  const childrenOk =
    Array.isArray(boxes) && boxes.length <= MAX_GEOMETRY_CHILDREN && boxes.every(isBox);
  return {
    elements: elements.map(readGeometry),
    children: children && childrenOk ? (boxes as EditingElementBox[]) : null,
  };
}

const isFlag = (value: unknown) => typeof value === "boolean";
const isFiniteFields = (value: unknown, keys: string[]) =>
  isFields(value) && keys.every((key) => Number.isFinite(value[key]));

const readGestureStart = (value: unknown): EditingGestureStart | null => {
  if (!readGeometry(value) || !isFields(value)) return null;
  const { layout, move, gsap } = value;
  const valid = [
    isFiniteFields(layout, ["width", "height"]),
    move === null || isFiniteFields(move, ["a", "b", "c", "d"]),
    gsap === null || (isFields(gsap) && isFiniteFields(gsap, ["x", "y"]) && isFlag(gsap.moving)),
  ];
  return valid.includes(false) ? null : (value as unknown as EditingGestureStart);
};

export interface PreviewGestureStartReply {
  /** One entry per handle, in order: null for an element the frame no longer has. */
  elements: Array<EditingGestureStart | null>;
  snap: EditingElementBox[];
}

/** What a gesture on `handles` starts from, in one read; null when the runtime cannot answer. */
export async function previewGestureStart(
  iframe: HTMLIFrameElement,
  handles: readonly string[],
): Promise<PreviewGestureStartReply | null> {
  if (!handles.length || handles.length > MAX_DESCRIBE_HANDLES) return null;
  const reply = await previewRequest(iframe, "gesture-start", { handles: [...handles] });
  const elements: unknown = reply?.elements;
  const snap: unknown = reply?.snap;
  if (!Array.isArray(elements) || elements.length !== handles.length) return null;
  if (!Array.isArray(snap) || snap.length > MAX_SNAP_TARGETS || !snap.every(isBox)) return null;
  return { elements: elements.map(readGestureStart), snap };
}

const LAYER_KINDS = new Set(["image", "video", "audio", "vector", "group", "text", "shape"]);
const isLayer = (value: unknown): value is EditingLayer =>
  isFields(value) &&
  isHandle(value.handle) &&
  isCount(value.depth) &&
  isCount(value.childCount) &&
  Number.isFinite(value.zIndex) &&
  LAYER_KINDS.has(value.kind as string);

export interface PreviewLayers {
  layers: EditingLayer[];
  truncated: boolean;
  missingGroup: boolean;
}

/** One page of the frame's layers in document order from `offset`, scoped to `group` when given; null when the runtime cannot answer. */
export async function previewLayers(
  iframe: HTMLIFrameElement,
  group?: string,
  offset = 0,
): Promise<PreviewLayers | null> {
  const params = { ...(group ? { group } : {}), ...(offset ? { offset } : {}) };
  const reply = await previewRequest(iframe, "layers", params);
  const layers: unknown = reply?.layers;
  const { truncated, missingGroup } = reply ?? {};
  if (!Array.isArray(layers) || typeof truncated !== "boolean") return null;
  if (typeof missingGroup !== "boolean") return null;
  return layers.every(isLayer) ? { layers, truncated, missingGroup } : null;
}
