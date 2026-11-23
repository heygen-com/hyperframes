/**
 * Elements of a preview frame Studio cannot script, by the handles its runtime gives them. A handle
 * names an element for one load of the frame; after the frame loads again, describe it afresh.
 */
import {
  EDITING_ELEMENT_HANDLE,
  MAX_DESCRIBE_HANDLES,
  MAX_DRAFT_DEG,
  MAX_DRAFT_PX,
  MAX_ELEMENT_ENTRIES,
  MAX_ELEMENT_TEXT,
  MAX_ELEMENT_VALUE,
  MAX_GEOMETRY_CHILDREN,
  MAX_QUERY_MATCHES,
  MAX_SNAP_TARGETS,
  MAX_SOURCE_GROUPS,
  isTransformList,
  type EditingElementBox,
  type EditingElementDescription,
  type EditingElementGeometry,
  type EditingGestureStart,
  type EditingElementHit,
  type EditingElementMatch,
  type EditingElementSource,
  type EditingLayer,
  type EditingStackingSibling,
} from "@hyperframes/core/runtime/editing-port";
import { resolveElementSourceFile } from "../../components/editor/domEditingDom";
import { previewRequest } from "./previewChannel";

declare const checked: unique symbol;
/** A description that passed `readPreviewElement`. Only that function makes one. */
export type PreviewElement = EditingElementDescription & { readonly [checked]: true };
export type PreviewElementHit = EditingElementHit & { readonly [checked]: true };

type Fields = Record<string, unknown>;
export const isFields = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export const isHandle = (value: unknown) =>
  typeof value === "string" && EDITING_ELEMENT_HANDLE.test(value);
const isText = (value: unknown) => typeof value === "string";
const isValue = (value: unknown) => isText(value) && (value as string).length <= MAX_ELEMENT_VALUE;
const isLongText = (value: unknown) =>
  isText(value) && (value as string).length <= MAX_ELEMENT_TEXT;
const isValueOrNull = (value: unknown) => value === null || isValue(value);
const isEntries = (value: unknown): value is unknown[] =>
  Array.isArray(value) && value.length <= MAX_ELEMENT_ENTRIES;
const isCount = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;

const isSource = (value: unknown): value is EditingElementSource =>
  isFields(value) &&
  isValueOrNull(value.file) &&
  isValueOrNull(value.compositionId) &&
  isValueOrNull(value.originalCompositionId);

const isStyles = (value: unknown) =>
  isFields(value) &&
  isEntries(Object.keys(value)) &&
  Object.entries(value).every(([name, style]) => isValue(name) && isValue(style));

function hasPlainFields(value: Fields): boolean {
  const { matchesBefore, attributes, children } = value;
  const groupsOk =
    matchesBefore === null ||
    (Array.isArray(matchesBefore) &&
      matchesBefore.length <= MAX_SOURCE_GROUPS &&
      matchesBefore.every((g) => isFields(g) && isSource(g.source) && isCount(g.count)));
  const attributesOk =
    isEntries(attributes) &&
    attributes.every((a) => Array.isArray(a) && a.length === 2 && a.every(isValue));
  const childrenOk =
    isEntries(children) &&
    children.every((c) => isFields(c) && (isHandle(c.handle) || isLongText(c.text)));
  return groupsOk && attributesOk && childrenOk && typeof value.truncated === "boolean";
}

const isRect = (value: unknown) =>
  isFields(value) && [value.x, value.y, value.width, value.height].every(Number.isFinite);

function readHit(value: unknown): PreviewElementHit | null {
  if (!isFields(value) || !isHandle(value.handle) || !isValue(value.tag)) return null;
  return isRect(value.rect) ? (value as unknown as PreviewElementHit) : null;
}

/** Frame data checked against `EditingElementDescription`; null when any field is off. */
export function readPreviewElement(value: unknown): PreviewElement | null {
  if (!readHit(value) || !isFields(value)) return null;
  if (value.parent !== null && !isHandle(value.parent)) return null;
  if (value.label !== undefined && !isValue(value.label)) return null;
  if (!isValueOrNull(value.id) || !isValueOrNull(value.selector)) return null;
  if (!isSource(value.source) || typeof value.locked !== "boolean") return null;
  if (!isStyles(value.inlineStyles) || !isLongText(value.text)) return null;
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

const isClipPath = isValueOrNull;

const isLayout = (value: unknown) =>
  isFields(value) &&
  [value.width, value.height].every(
    (side) => Number.isFinite(side) && (side as number) >= 0 && (side as number) <= MAX_DRAFT_PX,
  );

const isBox = (value: unknown): value is EditingElementBox =>
  isFields(value) &&
  isRect(value.rect) &&
  Number.isFinite(value.angle) &&
  isCorners(value.corners) &&
  isSourceBox(value.source) &&
  isClipPath(value.clipPath) &&
  isLayout(value.layout);

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

const isTurnOrNull = (value: unknown) =>
  value === null || (Number.isFinite(value) && Math.abs(value as number) <= MAX_DRAFT_DEG);

const kept = <T>(value: T, valid: boolean) => (valid ? value : undefined);

const isTurn = (value: unknown) => value !== null && isTurnOrNull(value);

const isRotationTarget = (target: unknown) =>
  isFields(target) &&
  (target.property === "rotate" || target.property === "transform") &&
  isTransformList(target.before) &&
  isTransformList(target.after) &&
  isTurn(target.share) &&
  (target.sign === 1 || target.sign === -1) &&
  isFlag(target.inline);

const isCssRotation = (value: unknown) =>
  value === null || (isFields(value) && isTurn(value.angle) && isRotationTarget(value.target));

export type ReadGestureStart = Omit<
  EditingGestureStart,
  "gsapRotation" | "cssRotation" | "planar" | "grow"
> & {
  gsapRotation?: number | null;
  grow?: EditingGestureStart["grow"];
  cssRotation?: EditingGestureStart["cssRotation"];
};

const readGestureStart = (value: unknown): ReadGestureStart | null => {
  if (!readGeometry(value) || !isFields(value)) return null;
  const { move, gsap, gsapRotation, grow, cssRotation } = value;
  const valid = [
    move === null || isFiniteFields(move, ["a", "b", "c", "d"]),
    gsap === null || (isFields(gsap) && isFiniteFields(gsap, ["x", "y"]) && isFlag(gsap.moving)),
  ];
  if (valid.includes(false)) return null;
  const { planar: _planar, ...start } = value as unknown as EditingGestureStart;
  return {
    ...start,
    gsapRotation: kept(start.gsapRotation, isTurnOrNull(gsapRotation)),
    grow: kept(start.grow, isFiniteFields(grow, ["a", "b", "c", "d"])),
    cssRotation: kept(start.cssRotation, isCssRotation(cssRotation)),
  };
};

export interface PreviewGestureStartReply {
  /** One entry per handle, in order: null for an element the frame no longer has. */
  elements: Array<ReadGestureStart | null>;
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

const isSibling = (value: unknown): value is EditingStackingSibling =>
  isFields(value) && isHandle(value.handle) && Number.isSafeInteger(value.zIndex);

export async function previewStackingSiblings(iframe: HTMLIFrameElement, handle: string) {
  const reply = await previewRequest(iframe, "stacking-family", { handle });
  const family: unknown = reply?.family;
  const locked: unknown = reply?.locked;
  if (!Array.isArray(family) || family.length > MAX_QUERY_MATCHES) return null;
  if (typeof locked !== "boolean" || !family.every(isSibling)) return null;
  const handles = new Set(family.map((sibling) => sibling.handle));
  return handles.size === family.length && handles.has(handle) ? { family, locked } : null;
}

type EditEntry = [name: string, value: string | null];
type StyleEntry = [name: string, value: string | null, priority?: "important"];
const isEditEntries = (value: unknown, priority = false): value is StyleEntry[] =>
  Array.isArray(value) &&
  value.every(
    (entry) =>
      Array.isArray(entry) &&
      isText(entry[0]) &&
      (entry[1] === null || isText(entry[1])) &&
      (entry.length === 2 || (priority && entry.length === 3 && entry[2] === "important")),
  );

type EditReply = Awaited<ReturnType<typeof previewRequest<"edit-element">>>;

function heldBefore(before: EditReply | null | undefined) {
  if (!before?.applied || !isEditEntries(before.styles, true)) return null;
  if (!isEditEntries(before.attributes)) return null;
  const html = typeof before.html === "string" ? before.html : undefined;
  return { styles: before.styles, attributes: before.attributes, html };
}

function ownedPutBack(
  before: EditReply | null | undefined,
  owns: (part: string, name: string) => boolean,
) {
  const held = heldBefore(before);
  if (!held) return null;
  const styles = held.styles.filter(([name]) => owns("style", name));
  const attributes = held.attributes.filter(([name]) => owns("attr", name));
  const html = owns("html", "") ? held.html : undefined;
  const any = styles.length > 0 || attributes.length > 0 || html !== undefined;
  return any ? { styles, attributes, html } : null;
}

export interface PreviewElementEdit {
  drawn: Promise<boolean>;
  restore(names?: readonly string[]): void;
}

const latestWriters = new WeakMap<HTMLIFrameElement, Map<string, symbol>>();

/** Draws inline `styles`, `attributes` and text markup on the frame's element, null removing one. */
export function editPreviewElement(
  iframe: HTMLIFrameElement,
  handle: string,
  edit: { styles?: EditEntry[]; attributes?: EditEntry[]; html?: string },
): PreviewElementEdit {
  const send = (styles: StyleEntry[], attributes: EditEntry[], html?: string) =>
    previewRequest(iframe, "edit-element", {
      handle,
      styles,
      attributes,
      ...(html !== undefined && { html }),
    });
  const writers = latestWriters.get(iframe) ?? new Map<string, symbol>();
  latestWriters.set(iframe, writers);
  const self = Symbol("edit");
  const key = (part: string, name: string) => `${handle} ${part} ${name}`;
  for (const [name] of edit.styles ?? []) writers.set(key("style", name), self);
  for (const [name] of edit.attributes ?? []) writers.set(key("attr", name), self);
  if (edit.html !== undefined) writers.set(key("html", ""), self);
  const reply = send(edit.styles ?? [], edit.attributes ?? [], edit.html);
  return {
    drawn: reply.then((before) => before?.applied === true),
    restore(names) {
      // Checked when the old values go back: a later edit of a name owns it by then.
      const owns = (part: string, name: string) =>
        (!names || names.includes(name)) && writers.get(key(part, name)) === self;
      void reply.then((before) => {
        const back = ownedPutBack(before, owns);
        if (back) void send(back.styles, back.attributes, back.html);
      });
    },
  };
}

const SEALED_DRAW_WAIT_MS = 300;

/** Saves a live edit at once; a sealed one once the frame says it drew it, else after the wait. */
export function afterSealedDraw<T>(
  edit: Pick<PreviewElementEdit, "drawn"> | null,
  save: (drawn: boolean) => T,
) {
  if (!edit) return save(true);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<boolean>((resolve) => {
    timer = setTimeout(resolve, SEALED_DRAW_WAIT_MS, false);
  });
  return Promise.race([edit.drawn, late]).then((drawn) => {
    clearTimeout(timer);
    return save(drawn);
  });
}
