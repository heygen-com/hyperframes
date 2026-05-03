import type { DomEditSelection } from "./domEditing";

export const STUDIO_MANUAL_EDITS_PATH = ".hyperframes/studio-manual-edits.json";
export const STUDIO_OFFSET_X_PROP = "--hf-studio-offset-x";
export const STUDIO_OFFSET_Y_PROP = "--hf-studio-offset-y";
export const STUDIO_WIDTH_PROP = "--hf-studio-width";
export const STUDIO_HEIGHT_PROP = "--hf-studio-height";
export const STUDIO_ROTATION_PROP = "--hf-studio-rotation";
const STUDIO_PATH_OFFSET_ATTR = "data-hf-studio-path-offset";
const STUDIO_MANUAL_EDIT_GESTURE_ATTR = "data-hf-studio-manual-edit-gesture";
const STUDIO_BOX_SIZE_ATTR = "data-hf-studio-box-size";
const STUDIO_ROTATION_ATTR = "data-hf-studio-rotation";
const STUDIO_ORIGINAL_TRANSLATE_ATTR = "data-hf-studio-original-translate";
const STUDIO_ORIGINAL_INLINE_TRANSLATE_ATTR = "data-hf-studio-original-inline-translate";
const STUDIO_ORIGINAL_WIDTH_ATTR = "data-hf-studio-original-width";
const STUDIO_ORIGINAL_HEIGHT_ATTR = "data-hf-studio-original-height";
const STUDIO_ORIGINAL_MIN_WIDTH_ATTR = "data-hf-studio-original-min-width";
const STUDIO_ORIGINAL_MIN_HEIGHT_ATTR = "data-hf-studio-original-min-height";
const STUDIO_ORIGINAL_MAX_WIDTH_ATTR = "data-hf-studio-original-max-width";
const STUDIO_ORIGINAL_MAX_HEIGHT_ATTR = "data-hf-studio-original-max-height";
const STUDIO_ORIGINAL_FLEX_BASIS_ATTR = "data-hf-studio-original-flex-basis";
const STUDIO_ORIGINAL_FLEX_GROW_ATTR = "data-hf-studio-original-flex-grow";
const STUDIO_ORIGINAL_FLEX_SHRINK_ATTR = "data-hf-studio-original-flex-shrink";
const STUDIO_ORIGINAL_BOX_SIZING_ATTR = "data-hf-studio-original-box-sizing";
const STUDIO_ORIGINAL_SCALE_ATTR = "data-hf-studio-original-scale";
const STUDIO_ORIGINAL_TRANSFORM_ORIGIN_ATTR = "data-hf-studio-original-transform-origin";
const STUDIO_ORIGINAL_DISPLAY_ATTR = "data-hf-studio-original-display";
const STUDIO_ORIGINAL_ROTATE_ATTR = "data-hf-studio-original-rotate";
const STUDIO_ORIGINAL_INLINE_ROTATE_ATTR = "data-hf-studio-original-inline-rotate";
const STUDIO_ORIGINAL_ROTATION_TRANSFORM_ORIGIN_ATTR =
  "data-hf-studio-original-rotation-transform-origin";
const STUDIO_ROTATION_DRAFT_ATTR = "data-hf-studio-rotation-draft";
const STUDIO_MANUAL_EDITS_APPLY_PROP = "__hfStudioManualEditsApply";
const STUDIO_MANUAL_EDITS_WRAPPED_PROP = "__hfStudioManualEditsWrapped";
const STUDIO_MANUAL_EDITS_PLAYBACK_FRAME_PROP = "__hfStudioManualEditsPlaybackFrame";
const STUDIO_ROTATION_TRANSFORM_ORIGIN = "center center";
let studioManualEditGestureId = 0;

export interface StudioManualEditTarget {
  sourceFile: string;
  selector?: string;
  selectorIndex?: number;
  id?: string;
}

export interface StudioPathOffsetEdit {
  kind: "path-offset";
  target: StudioManualEditTarget;
  x: number;
  y: number;
  updatedAt?: string;
}

export interface StudioBoxSizeEdit {
  kind: "box-size";
  target: StudioManualEditTarget;
  width: number;
  height: number;
  updatedAt?: string;
}

export interface StudioRotationEdit {
  kind: "rotation";
  target: StudioManualEditTarget;
  angle: number;
  updatedAt?: string;
}

export type StudioManualEdit = StudioPathOffsetEdit | StudioBoxSizeEdit | StudioRotationEdit;

export interface StudioManualEditManifest {
  version: 1;
  edits: StudioManualEdit[];
}

type StudioManualEditSeekWindow = Window & {
  __hf?: Record<string, unknown>;
  __player?: Record<string, unknown>;
  __timeline?: Record<string, unknown>;
  __timelines?: Record<string, Record<string, unknown>>;
  __hfStudioManualEditsApply?: () => void;
  __hfStudioManualEditsPlaybackFrame?: number | null;
};

export function emptyStudioManualEditManifest(): StudioManualEditManifest {
  return { version: 1, edits: [] };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parsePathOffsetEdit(value: unknown): StudioPathOffsetEdit | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.kind !== "path-offset") return null;
  const target = record.target;
  if (!target || typeof target !== "object") return null;
  const targetRecord = target as Record<string, unknown>;
  const sourceFile = typeof targetRecord.sourceFile === "string" ? targetRecord.sourceFile : "";
  if (!sourceFile) return null;

  const selector = typeof targetRecord.selector === "string" ? targetRecord.selector : undefined;
  const id = typeof targetRecord.id === "string" ? targetRecord.id : undefined;
  if (!selector && !id) return null;

  const x = finiteNumber(record.x);
  const y = finiteNumber(record.y);
  if (x == null || y == null) return null;

  return {
    kind: "path-offset",
    target: {
      sourceFile,
      selector,
      selectorIndex: finiteNumber(targetRecord.selectorIndex) ?? undefined,
      id,
    },
    x,
    y,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined,
  };
}

function parseBoxSizeEdit(value: unknown): StudioBoxSizeEdit | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.kind !== "box-size") return null;
  const target = record.target;
  if (!target || typeof target !== "object") return null;
  const targetRecord = target as Record<string, unknown>;
  const sourceFile = typeof targetRecord.sourceFile === "string" ? targetRecord.sourceFile : "";
  if (!sourceFile) return null;

  const selector = typeof targetRecord.selector === "string" ? targetRecord.selector : undefined;
  const id = typeof targetRecord.id === "string" ? targetRecord.id : undefined;
  if (!selector && !id) return null;

  const width = finiteNumber(record.width);
  const height = finiteNumber(record.height);
  if (width == null || height == null || width <= 0 || height <= 0) return null;

  return {
    kind: "box-size",
    target: {
      sourceFile,
      selector,
      selectorIndex: finiteNumber(targetRecord.selectorIndex) ?? undefined,
      id,
    },
    width,
    height,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined,
  };
}

function parseRotationEdit(value: unknown): StudioRotationEdit | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.kind !== "rotation") return null;
  const target = record.target;
  if (!target || typeof target !== "object") return null;
  const targetRecord = target as Record<string, unknown>;
  const sourceFile = typeof targetRecord.sourceFile === "string" ? targetRecord.sourceFile : "";
  if (!sourceFile) return null;

  const selector = typeof targetRecord.selector === "string" ? targetRecord.selector : undefined;
  const id = typeof targetRecord.id === "string" ? targetRecord.id : undefined;
  if (!selector && !id) return null;

  const angle = finiteNumber(record.angle);
  if (angle == null) return null;

  return {
    kind: "rotation",
    target: {
      sourceFile,
      selector,
      selectorIndex: finiteNumber(targetRecord.selectorIndex) ?? undefined,
      id,
    },
    angle,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined,
  };
}

function parseManualEdit(value: unknown): StudioManualEdit | null {
  return parsePathOffsetEdit(value) ?? parseBoxSizeEdit(value) ?? parseRotationEdit(value);
}

export function parseStudioManualEditManifest(content: string): StudioManualEditManifest {
  if (!content.trim()) return emptyStudioManualEditManifest();

  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== "object") return emptyStudioManualEditManifest();
    const edits = (parsed as { edits?: unknown }).edits;
    if (!Array.isArray(edits)) return emptyStudioManualEditManifest();
    return {
      version: 1,
      edits: edits.map(parseManualEdit).filter((edit): edit is StudioManualEdit => edit !== null),
    };
  } catch {
    return emptyStudioManualEditManifest();
  }
}

export function serializeStudioManualEditManifest(manifest: StudioManualEditManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function normalizeStudioFileChangePath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "");
}

function readStudioFileChangePathFromValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("{")) {
      try {
        return readStudioFileChangePathFromValue(JSON.parse(trimmed) as unknown);
      } catch {
        return normalizeStudioFileChangePath(trimmed);
      }
    }
    return normalizeStudioFileChangePath(trimmed);
  }

  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.path === "string") return normalizeStudioFileChangePath(record.path);
  if (typeof record.filePath === "string") return normalizeStudioFileChangePath(record.filePath);
  if ("data" in record) return readStudioFileChangePathFromValue(record.data);
  return null;
}

export function readStudioFileChangePath(payload: unknown): string | null {
  return readStudioFileChangePathFromValue(payload);
}

export function isStudioManualEditManifestPath(path: string | null): boolean {
  if (!path) return false;
  const normalized = normalizeStudioFileChangePath(path);
  return (
    normalized === STUDIO_MANUAL_EDITS_PATH || normalized.endsWith(`/${STUDIO_MANUAL_EDITS_PATH}`)
  );
}

function selectionTarget(selection: DomEditSelection): StudioManualEditTarget {
  return {
    sourceFile: selection.sourceFile || "index.html",
    selector: selection.selector,
    selectorIndex: selection.selectorIndex,
    id: selection.id ?? undefined,
  };
}

function targetKey(target: StudioManualEditTarget): string {
  return [
    target.sourceFile,
    target.id ?? "",
    target.selector ?? "",
    target.selectorIndex ?? "",
  ].join("|");
}

function roundRotationAngle(angle: number): number {
  return Math.round(angle * 10) / 10;
}

export function upsertStudioPathOffsetEdit(
  manifest: StudioManualEditManifest,
  selection: DomEditSelection,
  offset: { x: number; y: number },
): StudioManualEditManifest {
  const target = selectionTarget(selection);
  const key = targetKey(target);
  const nextEdit: StudioPathOffsetEdit = {
    kind: "path-offset",
    target,
    x: Math.round(offset.x),
    y: Math.round(offset.y),
    updatedAt: new Date().toISOString(),
  };

  const edits = manifest.edits.filter(
    (edit) => edit.kind !== "path-offset" || targetKey(edit.target) !== key,
  );
  edits.push(nextEdit);
  return { version: 1, edits };
}

export function upsertStudioBoxSizeEdit(
  manifest: StudioManualEditManifest,
  selection: DomEditSelection,
  size: { width: number; height: number },
): StudioManualEditManifest {
  const target = selectionTarget(selection);
  const key = targetKey(target);
  const nextEdit: StudioBoxSizeEdit = {
    kind: "box-size",
    target,
    width: Math.round(Math.max(1, size.width)),
    height: Math.round(Math.max(1, size.height)),
    updatedAt: new Date().toISOString(),
  };

  const edits = manifest.edits.filter(
    (edit) => edit.kind !== "box-size" || targetKey(edit.target) !== key,
  );
  edits.push(nextEdit);
  return { version: 1, edits };
}

export function upsertStudioRotationEdit(
  manifest: StudioManualEditManifest,
  selection: DomEditSelection,
  rotation: { angle: number },
): StudioManualEditManifest {
  const target = selectionTarget(selection);
  const key = targetKey(target);
  const nextEdit: StudioRotationEdit = {
    kind: "rotation",
    target,
    angle: roundRotationAngle(rotation.angle),
    updatedAt: new Date().toISOString(),
  };

  const edits = manifest.edits.filter(
    (edit) => edit.kind !== "rotation" || targetKey(edit.target) !== key,
  );
  edits.push(nextEdit);
  return { version: 1, edits };
}

export function removeStudioManualEditsForSelection(
  manifest: StudioManualEditManifest,
  selection: DomEditSelection,
): StudioManualEditManifest {
  const key = targetKey(selectionTarget(selection));
  const edits = manifest.edits.filter((edit) => targetKey(edit.target) !== key);
  if (edits.length === manifest.edits.length) return manifest;
  return { version: 1, edits };
}

function readPxCustomProperty(element: HTMLElement, property: string): number {
  const value = Number.parseFloat(element.style.getPropertyValue(property));
  return Number.isFinite(value) ? value : 0;
}

function readDegreeCustomProperty(element: HTMLElement, property: string): number {
  const value = Number.parseFloat(element.style.getPropertyValue(property));
  return Number.isFinite(value) ? value : 0;
}

export function readStudioPathOffset(element: HTMLElement): { x: number; y: number } {
  return {
    x: readPxCustomProperty(element, STUDIO_OFFSET_X_PROP),
    y: readPxCustomProperty(element, STUDIO_OFFSET_Y_PROP),
  };
}

export function readStudioBoxSize(element: HTMLElement): { width: number; height: number } {
  return {
    width: readPxCustomProperty(element, STUDIO_WIDTH_PROP),
    height: readPxCustomProperty(element, STUDIO_HEIGHT_PROP),
  };
}

export function readStudioRotation(element: HTMLElement): { angle: number } {
  return {
    angle: readDegreeCustomProperty(element, STUDIO_ROTATION_PROP),
  };
}

export function beginStudioManualEditGesture(element: HTMLElement): string {
  studioManualEditGestureId += 1;
  const token = `gesture-${studioManualEditGestureId}`;
  element.setAttribute(STUDIO_MANUAL_EDIT_GESTURE_ATTR, token);
  return token;
}

export function endStudioManualEditGesture(element: HTMLElement, token?: string): void {
  if (token && element.getAttribute(STUDIO_MANUAL_EDIT_GESTURE_ATTR) !== token) return;
  element.removeAttribute(STUDIO_MANUAL_EDIT_GESTURE_ATTR);
}

function isStudioManualEditGestureActive(element: HTMLElement): boolean {
  return element.hasAttribute(STUDIO_MANUAL_EDIT_GESTURE_ATTR);
}

export function isStudioManualEditGestureCurrent(element: HTMLElement, token: string): boolean {
  return element.getAttribute(STUDIO_MANUAL_EDIT_GESTURE_ATTR) === token;
}

function splitTopLevelWhitespace(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value.trim()) {
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);
    if (/\s/.test(char) && depth === 0) {
      if (current) parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function composeTranslateValue(element: HTMLElement, x: string, y: string): string {
  const original = element.getAttribute(STUDIO_ORIGINAL_TRANSLATE_ATTR)?.trim();
  if (!original || original === "none") return `${x} ${y}`;

  const parts = splitTopLevelWhitespace(original);
  if (parts.length === 1) return `calc(${parts[0]} + ${x}) ${y}`;
  if (parts.length === 2) return `calc(${parts[0]} + ${x}) calc(${parts[1]} + ${y})`;
  if (parts.length === 3) {
    return `calc(${parts[0]} + ${x}) calc(${parts[1]} + ${y}) ${parts[2]}`;
  }
  return `${x} ${y}`;
}

function readTransformLonghandBase(element: HTMLElement, property: "translate" | "rotate"): string {
  const value = readStyleOrComputed(element, property).trim();
  return value === "none" ? "" : value;
}

function prepareStudioPathOffsetBase(element: HTMLElement, updateBase: boolean): void {
  const inlineTranslate = element.style.getPropertyValue("translate");
  const currentTranslate = readTransformLonghandBase(element, "translate");
  const hasMarker = element.hasAttribute(STUDIO_PATH_OFFSET_ATTR);
  const wasResetByAnimation = !styleUsesStudioOffset(currentTranslate);
  if (!hasMarker) {
    element.setAttribute(
      STUDIO_ORIGINAL_INLINE_TRANSLATE_ATTR,
      styleUsesStudioOffset(inlineTranslate) ? "" : inlineTranslate,
    );
    element.setAttribute(
      STUDIO_ORIGINAL_TRANSLATE_ATTR,
      wasResetByAnimation ? currentTranslate : "",
    );
  } else if (updateBase && wasResetByAnimation && !isStudioManualEditGestureActive(element)) {
    element.setAttribute(STUDIO_ORIGINAL_TRANSLATE_ATTR, currentTranslate);
  }
}

function writeStudioPathOffsetVars(
  element: HTMLElement,
  offset: { x: number; y: number },
  options: { updateBase?: boolean } = {},
): void {
  prepareStudioPathOffsetBase(element, options.updateBase ?? true);
  element.setAttribute(STUDIO_PATH_OFFSET_ATTR, "true");
  element.style.setProperty(STUDIO_OFFSET_X_PROP, `${Math.round(offset.x)}px`);
  element.style.setProperty(STUDIO_OFFSET_Y_PROP, `${Math.round(offset.y)}px`);
}

function writeStudioBoxSizeVars(
  element: HTMLElement,
  size: { width: number; height: number },
): void {
  if (!element.hasAttribute(STUDIO_BOX_SIZE_ATTR)) {
    element.setAttribute(STUDIO_ORIGINAL_WIDTH_ATTR, element.style.getPropertyValue("width"));
    element.setAttribute(STUDIO_ORIGINAL_HEIGHT_ATTR, element.style.getPropertyValue("height"));
    element.setAttribute(
      STUDIO_ORIGINAL_MIN_WIDTH_ATTR,
      element.style.getPropertyValue("min-width"),
    );
    element.setAttribute(
      STUDIO_ORIGINAL_MIN_HEIGHT_ATTR,
      element.style.getPropertyValue("min-height"),
    );
    element.setAttribute(
      STUDIO_ORIGINAL_MAX_WIDTH_ATTR,
      element.style.getPropertyValue("max-width"),
    );
    element.setAttribute(
      STUDIO_ORIGINAL_MAX_HEIGHT_ATTR,
      element.style.getPropertyValue("max-height"),
    );
    element.setAttribute(
      STUDIO_ORIGINAL_FLEX_BASIS_ATTR,
      element.style.getPropertyValue("flex-basis"),
    );
    element.setAttribute(
      STUDIO_ORIGINAL_FLEX_GROW_ATTR,
      element.style.getPropertyValue("flex-grow"),
    );
    element.setAttribute(
      STUDIO_ORIGINAL_FLEX_SHRINK_ATTR,
      element.style.getPropertyValue("flex-shrink"),
    );
    element.setAttribute(
      STUDIO_ORIGINAL_BOX_SIZING_ATTR,
      element.style.getPropertyValue("box-sizing"),
    );
    element.setAttribute(STUDIO_ORIGINAL_SCALE_ATTR, element.style.getPropertyValue("scale"));
    element.setAttribute(
      STUDIO_ORIGINAL_TRANSFORM_ORIGIN_ATTR,
      element.style.getPropertyValue("transform-origin"),
    );
    element.setAttribute(STUDIO_ORIGINAL_DISPLAY_ATTR, element.style.getPropertyValue("display"));
  }

  element.setAttribute(STUDIO_BOX_SIZE_ATTR, "true");
  element.style.setProperty(STUDIO_WIDTH_PROP, `${Math.round(Math.max(1, size.width))}px`);
  element.style.setProperty(STUDIO_HEIGHT_PROP, `${Math.round(Math.max(1, size.height))}px`);
}

function prepareStudioRotationBase(element: HTMLElement, updateBase: boolean): void {
  const inlineRotate = element.style.getPropertyValue("rotate");
  const currentRotate = readTransformLonghandBase(element, "rotate");
  const hasMarker = element.hasAttribute(STUDIO_ROTATION_ATTR);
  const wasResetByAnimation =
    !styleUsesStudioRotation(currentRotate) &&
    !styleMatchesStudioRotationDraft(element, currentRotate);
  if (!hasMarker) {
    element.setAttribute(
      STUDIO_ORIGINAL_INLINE_ROTATE_ATTR,
      styleUsesStudioRotation(inlineRotate) ? "" : inlineRotate,
    );
    element.setAttribute(STUDIO_ORIGINAL_ROTATE_ATTR, wasResetByAnimation ? currentRotate : "");
  } else if (updateBase && wasResetByAnimation && !isStudioManualEditGestureActive(element)) {
    element.setAttribute(STUDIO_ORIGINAL_ROTATE_ATTR, currentRotate);
  }
  if (!element.hasAttribute(STUDIO_ORIGINAL_ROTATION_TRANSFORM_ORIGIN_ATTR)) {
    element.setAttribute(
      STUDIO_ORIGINAL_ROTATION_TRANSFORM_ORIGIN_ATTR,
      element.style.getPropertyValue("transform-origin"),
    );
  }
}

function writeStudioRotationVars(
  element: HTMLElement,
  rotation: { angle: number },
  options: { updateBase?: boolean } = {},
): void {
  prepareStudioRotationBase(element, options.updateBase ?? true);
  element.setAttribute(STUDIO_ROTATION_ATTR, "true");
  element.style.setProperty(STUDIO_ROTATION_PROP, `${roundRotationAngle(rotation.angle)}deg`);
  element.style.setProperty("transform-origin", STUDIO_ROTATION_TRANSFORM_ORIGIN);
}

function isSimpleRotateAngle(value: string): boolean {
  return /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:deg|rad|turn|grad)$/.test(value.trim());
}

function composeStudioRotationValue(element: HTMLElement, rotationValue: string): string {
  const original = element.getAttribute(STUDIO_ORIGINAL_ROTATE_ATTR)?.trim();
  if (!original || original === "none" || !isSimpleRotateAngle(original)) {
    return rotationValue;
  }
  return `calc(${original} + ${rotationValue})`;
}

function safeComputedStyleProperty(element: HTMLElement, property: string): string {
  try {
    return (
      element.ownerDocument.defaultView?.getComputedStyle(element).getPropertyValue(property) ?? ""
    );
  } catch {
    return "";
  }
}

function readStyleOrComputed(element: HTMLElement, property: string): string {
  return element.style.getPropertyValue(property) || safeComputedStyleProperty(element, property);
}

function readParentFlexBasisPixels(
  element: HTMLElement,
  size: { width: number; height: number },
): number | null {
  const parent = element.parentElement;
  if (!parent) return null;

  const display = readStyleOrComputed(parent, "display").trim();
  if (display !== "flex" && display !== "inline-flex") return null;

  const direction = readStyleOrComputed(parent, "flex-direction").trim();
  return Math.round(Math.max(1, direction.startsWith("column") ? size.height : size.width));
}

function restoreStaleStudioScaleResize(element: HTMLElement): void {
  if (!element.hasAttribute(STUDIO_ORIGINAL_SCALE_ATTR)) return;
  restoreOriginalBoxSizeProperty(element, "scale", STUDIO_ORIGINAL_SCALE_ATTR);
  restoreOriginalBoxSizeProperty(
    element,
    "transform-origin",
    STUDIO_ORIGINAL_TRANSFORM_ORIGIN_ATTR,
  );
}

function applyStudioBoxSizeDimensions(
  element: HTMLElement,
  size: { width: number; height: number },
): void {
  writeStudioBoxSizeVars(element, size);
  restoreStaleStudioScaleResize(element);

  const width = Math.round(Math.max(1, size.width));
  const height = Math.round(Math.max(1, size.height));
  element.style.setProperty("box-sizing", "border-box");
  element.style.setProperty("width", `${width}px`);
  element.style.setProperty("height", `${height}px`);
  element.style.setProperty("min-width", "0px");
  element.style.setProperty("min-height", "0px");
  element.style.setProperty("max-width", "none");
  element.style.setProperty("max-height", "none");
  const flexBasis = readParentFlexBasisPixels(element, size);
  if (flexBasis != null) {
    element.style.setProperty("flex-basis", `${flexBasis}px`);
    element.style.setProperty("flex-grow", "0");
    element.style.setProperty("flex-shrink", "0");
  }
  const computedDisplay = safeComputedStyleProperty(element, "display");
  if (computedDisplay === "inline") {
    element.style.setProperty("display", "inline-block");
  }
}

function styleUsesStudioOffset(value: string): boolean {
  return value.includes(STUDIO_OFFSET_X_PROP) || value.includes(STUDIO_OFFSET_Y_PROP);
}

function styleUsesStudioSize(value: string): boolean {
  return value.includes(STUDIO_WIDTH_PROP) || value.includes(STUDIO_HEIGHT_PROP);
}

function styleUsesStudioRotation(value: string): boolean {
  return value.includes(STUDIO_ROTATION_PROP);
}

function compactStyleValue(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

function styleMatchesStudioRotationDraft(element: HTMLElement, value: string): boolean {
  if (!element.hasAttribute(STUDIO_ROTATION_DRAFT_ATTR)) return false;
  const rotation = element.style.getPropertyValue(STUDIO_ROTATION_PROP).trim();
  if (!rotation || !value.trim()) return false;
  return (
    compactStyleValue(value) === compactStyleValue(composeStudioRotationValue(element, rotation))
  );
}

export function applyStudioPathOffset(
  element: HTMLElement,
  offset: { x: number; y: number },
): void {
  writeStudioPathOffsetVars(element, offset);
  element.style.setProperty(
    "translate",
    composeTranslateValue(
      element,
      `var(${STUDIO_OFFSET_X_PROP}, 0px)`,
      `var(${STUDIO_OFFSET_Y_PROP}, 0px)`,
    ),
  );
}

export function applyStudioPathOffsetDraft(
  element: HTMLElement,
  offset: { x: number; y: number },
): void {
  writeStudioPathOffsetVars(element, offset, { updateBase: false });
  element.style.setProperty(
    "translate",
    composeTranslateValue(element, `${Math.round(offset.x)}px`, `${Math.round(offset.y)}px`),
  );
}

export function applyStudioBoxSize(
  element: HTMLElement,
  size: { width: number; height: number },
): void {
  applyStudioBoxSizeDimensions(element, size);
}

export function applyStudioBoxSizeDraft(
  element: HTMLElement,
  size: { width: number; height: number },
): void {
  applyStudioBoxSizeDimensions(element, size);
}

export function applyStudioRotation(element: HTMLElement, rotation: { angle: number }): void {
  writeStudioRotationVars(element, rotation);
  element.removeAttribute(STUDIO_ROTATION_DRAFT_ATTR);
  element.style.setProperty(
    "rotate",
    composeStudioRotationValue(element, `var(${STUDIO_ROTATION_PROP}, 0deg)`),
  );
}

export function applyStudioRotationDraft(element: HTMLElement, rotation: { angle: number }): void {
  writeStudioRotationVars(element, rotation, { updateBase: false });
  element.setAttribute(STUDIO_ROTATION_DRAFT_ATTR, "true");
  element.style.setProperty(
    "rotate",
    composeStudioRotationValue(element, `${roundRotationAngle(rotation.angle)}deg`),
  );
}

function clearStudioPathOffset(element: HTMLElement): void {
  if (
    element.hasAttribute(STUDIO_PATH_OFFSET_ATTR) ||
    styleUsesStudioOffset(element.style.getPropertyValue("translate"))
  ) {
    restoreOriginalTranslateProperty(element);
  }
  element.style.removeProperty(STUDIO_OFFSET_X_PROP);
  element.style.removeProperty(STUDIO_OFFSET_Y_PROP);
  element.removeAttribute(STUDIO_PATH_OFFSET_ATTR);
  element.removeAttribute(STUDIO_ORIGINAL_TRANSLATE_ATTR);
  element.removeAttribute(STUDIO_ORIGINAL_INLINE_TRANSLATE_ATTR);
}

function clearStudioRotation(element: HTMLElement): void {
  if (
    element.hasAttribute(STUDIO_ROTATION_ATTR) ||
    styleUsesStudioRotation(element.style.getPropertyValue("rotate"))
  ) {
    restoreOriginalRotationProperty(element);
  }

  element.style.removeProperty(STUDIO_ROTATION_PROP);
  element.removeAttribute(STUDIO_ROTATION_ATTR);
  element.removeAttribute(STUDIO_ROTATION_DRAFT_ATTR);
  element.removeAttribute(STUDIO_ORIGINAL_ROTATE_ATTR);
  element.removeAttribute(STUDIO_ORIGINAL_INLINE_ROTATE_ATTR);
  element.removeAttribute(STUDIO_ORIGINAL_ROTATION_TRANSFORM_ORIGIN_ATTR);
}

function restoreOriginalBoxSizeProperty(
  element: HTMLElement,
  property:
    | "width"
    | "height"
    | "min-width"
    | "min-height"
    | "max-width"
    | "max-height"
    | "flex-basis"
    | "flex-grow"
    | "flex-shrink"
    | "box-sizing"
    | "scale"
    | "transform-origin"
    | "display",
  attribute: string,
): void {
  const original = element.getAttribute(attribute);
  if (original == null || original === "") element.style.removeProperty(property);
  else element.style.setProperty(property, original);
  element.removeAttribute(attribute);
}

function restoreOriginalRotationProperty(element: HTMLElement): void {
  const original = element.getAttribute(STUDIO_ORIGINAL_INLINE_ROTATE_ATTR);
  if (original == null || original === "") element.style.removeProperty("rotate");
  else element.style.setProperty("rotate", original);
  element.removeAttribute(STUDIO_ORIGINAL_INLINE_ROTATE_ATTR);
  element.removeAttribute(STUDIO_ORIGINAL_ROTATE_ATTR);

  const originalTransformOrigin = element.getAttribute(
    STUDIO_ORIGINAL_ROTATION_TRANSFORM_ORIGIN_ATTR,
  );
  if (originalTransformOrigin != null) {
    if (originalTransformOrigin === "") element.style.removeProperty("transform-origin");
    else element.style.setProperty("transform-origin", originalTransformOrigin);
  }
  element.removeAttribute(STUDIO_ORIGINAL_ROTATION_TRANSFORM_ORIGIN_ATTR);
}

function restoreOriginalTranslateProperty(element: HTMLElement): void {
  const original = element.getAttribute(STUDIO_ORIGINAL_INLINE_TRANSLATE_ATTR);
  if (original == null || original === "") element.style.removeProperty("translate");
  else element.style.setProperty("translate", original);
  element.removeAttribute(STUDIO_ORIGINAL_INLINE_TRANSLATE_ATTR);
  element.removeAttribute(STUDIO_ORIGINAL_TRANSLATE_ATTR);
}

function clearStudioBoxSize(element: HTMLElement): void {
  if (
    element.hasAttribute(STUDIO_BOX_SIZE_ATTR) ||
    styleUsesStudioSize(element.style.getPropertyValue("width")) ||
    styleUsesStudioSize(element.style.getPropertyValue("height")) ||
    element.hasAttribute(STUDIO_ORIGINAL_SCALE_ATTR)
  ) {
    restoreOriginalBoxSizeProperty(element, "width", STUDIO_ORIGINAL_WIDTH_ATTR);
    restoreOriginalBoxSizeProperty(element, "height", STUDIO_ORIGINAL_HEIGHT_ATTR);
    restoreOriginalBoxSizeProperty(element, "min-width", STUDIO_ORIGINAL_MIN_WIDTH_ATTR);
    restoreOriginalBoxSizeProperty(element, "min-height", STUDIO_ORIGINAL_MIN_HEIGHT_ATTR);
    restoreOriginalBoxSizeProperty(element, "max-width", STUDIO_ORIGINAL_MAX_WIDTH_ATTR);
    restoreOriginalBoxSizeProperty(element, "max-height", STUDIO_ORIGINAL_MAX_HEIGHT_ATTR);
    restoreOriginalBoxSizeProperty(element, "flex-basis", STUDIO_ORIGINAL_FLEX_BASIS_ATTR);
    restoreOriginalBoxSizeProperty(element, "flex-grow", STUDIO_ORIGINAL_FLEX_GROW_ATTR);
    restoreOriginalBoxSizeProperty(element, "flex-shrink", STUDIO_ORIGINAL_FLEX_SHRINK_ATTR);
    restoreOriginalBoxSizeProperty(element, "box-sizing", STUDIO_ORIGINAL_BOX_SIZING_ATTR);
    restoreOriginalBoxSizeProperty(element, "scale", STUDIO_ORIGINAL_SCALE_ATTR);
    restoreOriginalBoxSizeProperty(
      element,
      "transform-origin",
      STUDIO_ORIGINAL_TRANSFORM_ORIGIN_ATTR,
    );
    restoreOriginalBoxSizeProperty(element, "display", STUDIO_ORIGINAL_DISPLAY_ATTR);
  }

  element.style.removeProperty(STUDIO_WIDTH_PROP);
  element.style.removeProperty(STUDIO_HEIGHT_PROP);
  element.removeAttribute(STUDIO_BOX_SIZE_ATTR);
}

export interface StudioBoxSizeSnapshot {
  width: string;
  height: string;
  minWidth: string;
  minHeight: string;
  maxWidth: string;
  maxHeight: string;
  flexBasis: string;
  flexGrow: string;
  flexShrink: string;
  boxSizing: string;
  scale: string;
  transformOrigin: string;
  display: string;
  studioWidth: string;
  studioHeight: string;
  marker: string | null;
  originalWidth: string | null;
  originalHeight: string | null;
  originalMinWidth: string | null;
  originalMinHeight: string | null;
  originalMaxWidth: string | null;
  originalMaxHeight: string | null;
  originalFlexBasis: string | null;
  originalFlexGrow: string | null;
  originalFlexShrink: string | null;
  originalBoxSizing: string | null;
  originalScale: string | null;
  originalTransformOrigin: string | null;
  originalDisplay: string | null;
}

export interface StudioRotationSnapshot {
  rotate: string;
  transformOrigin: string;
  studioRotation: string;
  marker: string | null;
  draftMarker: string | null;
  originalRotate: string | null;
  originalInlineRotate: string | null;
  originalTransformOrigin: string | null;
}

export interface StudioPathOffsetSnapshot {
  translate: string;
  x: string;
  y: string;
  marker: string | null;
  originalTranslate: string | null;
  originalInlineTranslate: string | null;
}

export function captureStudioBoxSize(element: HTMLElement): StudioBoxSizeSnapshot {
  return {
    width: element.style.getPropertyValue("width"),
    height: element.style.getPropertyValue("height"),
    minWidth: element.style.getPropertyValue("min-width"),
    minHeight: element.style.getPropertyValue("min-height"),
    maxWidth: element.style.getPropertyValue("max-width"),
    maxHeight: element.style.getPropertyValue("max-height"),
    flexBasis: element.style.getPropertyValue("flex-basis"),
    flexGrow: element.style.getPropertyValue("flex-grow"),
    flexShrink: element.style.getPropertyValue("flex-shrink"),
    boxSizing: element.style.getPropertyValue("box-sizing"),
    scale: element.style.getPropertyValue("scale"),
    transformOrigin: element.style.getPropertyValue("transform-origin"),
    display: element.style.getPropertyValue("display"),
    studioWidth: element.style.getPropertyValue(STUDIO_WIDTH_PROP),
    studioHeight: element.style.getPropertyValue(STUDIO_HEIGHT_PROP),
    marker: element.getAttribute(STUDIO_BOX_SIZE_ATTR),
    originalWidth: element.getAttribute(STUDIO_ORIGINAL_WIDTH_ATTR),
    originalHeight: element.getAttribute(STUDIO_ORIGINAL_HEIGHT_ATTR),
    originalMinWidth: element.getAttribute(STUDIO_ORIGINAL_MIN_WIDTH_ATTR),
    originalMinHeight: element.getAttribute(STUDIO_ORIGINAL_MIN_HEIGHT_ATTR),
    originalMaxWidth: element.getAttribute(STUDIO_ORIGINAL_MAX_WIDTH_ATTR),
    originalMaxHeight: element.getAttribute(STUDIO_ORIGINAL_MAX_HEIGHT_ATTR),
    originalFlexBasis: element.getAttribute(STUDIO_ORIGINAL_FLEX_BASIS_ATTR),
    originalFlexGrow: element.getAttribute(STUDIO_ORIGINAL_FLEX_GROW_ATTR),
    originalFlexShrink: element.getAttribute(STUDIO_ORIGINAL_FLEX_SHRINK_ATTR),
    originalBoxSizing: element.getAttribute(STUDIO_ORIGINAL_BOX_SIZING_ATTR),
    originalScale: element.getAttribute(STUDIO_ORIGINAL_SCALE_ATTR),
    originalTransformOrigin: element.getAttribute(STUDIO_ORIGINAL_TRANSFORM_ORIGIN_ATTR),
    originalDisplay: element.getAttribute(STUDIO_ORIGINAL_DISPLAY_ATTR),
  };
}

export function captureStudioRotation(element: HTMLElement): StudioRotationSnapshot {
  return {
    rotate: element.style.getPropertyValue("rotate"),
    transformOrigin: element.style.getPropertyValue("transform-origin"),
    studioRotation: element.style.getPropertyValue(STUDIO_ROTATION_PROP),
    marker: element.getAttribute(STUDIO_ROTATION_ATTR),
    draftMarker: element.getAttribute(STUDIO_ROTATION_DRAFT_ATTR),
    originalRotate: element.getAttribute(STUDIO_ORIGINAL_ROTATE_ATTR),
    originalInlineRotate: element.getAttribute(STUDIO_ORIGINAL_INLINE_ROTATE_ATTR),
    originalTransformOrigin: element.getAttribute(STUDIO_ORIGINAL_ROTATION_TRANSFORM_ORIGIN_ATTR),
  };
}

export function captureStudioPathOffset(element: HTMLElement): StudioPathOffsetSnapshot {
  return {
    translate: element.style.getPropertyValue("translate"),
    x: element.style.getPropertyValue(STUDIO_OFFSET_X_PROP),
    y: element.style.getPropertyValue(STUDIO_OFFSET_Y_PROP),
    marker: element.getAttribute(STUDIO_PATH_OFFSET_ATTR),
    originalTranslate: element.getAttribute(STUDIO_ORIGINAL_TRANSLATE_ATTR),
    originalInlineTranslate: element.getAttribute(STUDIO_ORIGINAL_INLINE_TRANSLATE_ATTR),
  };
}

function restoreAttribute(element: HTMLElement, attribute: string, value: string | null): void {
  if (value == null) element.removeAttribute(attribute);
  else element.setAttribute(attribute, value);
}

function restoreStyleProperty(element: HTMLElement, property: string, value: string): void {
  if (value) element.style.setProperty(property, value);
  else element.style.removeProperty(property);
}

export function restoreStudioBoxSize(element: HTMLElement, previous: StudioBoxSizeSnapshot): void {
  restoreStyleProperty(element, "width", previous.width);
  restoreStyleProperty(element, "height", previous.height);
  restoreStyleProperty(element, "min-width", previous.minWidth);
  restoreStyleProperty(element, "min-height", previous.minHeight);
  restoreStyleProperty(element, "max-width", previous.maxWidth);
  restoreStyleProperty(element, "max-height", previous.maxHeight);
  restoreStyleProperty(element, "flex-basis", previous.flexBasis);
  restoreStyleProperty(element, "flex-grow", previous.flexGrow);
  restoreStyleProperty(element, "flex-shrink", previous.flexShrink);
  restoreStyleProperty(element, "box-sizing", previous.boxSizing);
  restoreStyleProperty(element, "scale", previous.scale);
  restoreStyleProperty(element, "transform-origin", previous.transformOrigin);
  restoreStyleProperty(element, "display", previous.display);
  restoreStyleProperty(element, STUDIO_WIDTH_PROP, previous.studioWidth);
  restoreStyleProperty(element, STUDIO_HEIGHT_PROP, previous.studioHeight);
  restoreAttribute(element, STUDIO_BOX_SIZE_ATTR, previous.marker);
  restoreAttribute(element, STUDIO_ORIGINAL_WIDTH_ATTR, previous.originalWidth);
  restoreAttribute(element, STUDIO_ORIGINAL_HEIGHT_ATTR, previous.originalHeight);
  restoreAttribute(element, STUDIO_ORIGINAL_MIN_WIDTH_ATTR, previous.originalMinWidth);
  restoreAttribute(element, STUDIO_ORIGINAL_MIN_HEIGHT_ATTR, previous.originalMinHeight);
  restoreAttribute(element, STUDIO_ORIGINAL_MAX_WIDTH_ATTR, previous.originalMaxWidth);
  restoreAttribute(element, STUDIO_ORIGINAL_MAX_HEIGHT_ATTR, previous.originalMaxHeight);
  restoreAttribute(element, STUDIO_ORIGINAL_FLEX_BASIS_ATTR, previous.originalFlexBasis);
  restoreAttribute(element, STUDIO_ORIGINAL_FLEX_GROW_ATTR, previous.originalFlexGrow);
  restoreAttribute(element, STUDIO_ORIGINAL_FLEX_SHRINK_ATTR, previous.originalFlexShrink);
  restoreAttribute(element, STUDIO_ORIGINAL_BOX_SIZING_ATTR, previous.originalBoxSizing);
  restoreAttribute(element, STUDIO_ORIGINAL_SCALE_ATTR, previous.originalScale);
  restoreAttribute(
    element,
    STUDIO_ORIGINAL_TRANSFORM_ORIGIN_ATTR,
    previous.originalTransformOrigin,
  );
  restoreAttribute(element, STUDIO_ORIGINAL_DISPLAY_ATTR, previous.originalDisplay);
}

export function restoreStudioRotation(
  element: HTMLElement,
  previous: StudioRotationSnapshot,
): void {
  restoreStyleProperty(element, "rotate", previous.rotate);
  restoreStyleProperty(element, "transform-origin", previous.transformOrigin);
  restoreStyleProperty(element, STUDIO_ROTATION_PROP, previous.studioRotation);
  restoreAttribute(element, STUDIO_ROTATION_ATTR, previous.marker);
  restoreAttribute(element, STUDIO_ROTATION_DRAFT_ATTR, previous.draftMarker);
  restoreAttribute(element, STUDIO_ORIGINAL_ROTATE_ATTR, previous.originalRotate);
  restoreAttribute(element, STUDIO_ORIGINAL_INLINE_ROTATE_ATTR, previous.originalInlineRotate);
  restoreAttribute(
    element,
    STUDIO_ORIGINAL_ROTATION_TRANSFORM_ORIGIN_ATTR,
    previous.originalTransformOrigin,
  );
}

export function restoreStudioPathOffset(
  element: HTMLElement,
  previous: StudioPathOffsetSnapshot,
): void {
  if (previous.translate) element.style.setProperty("translate", previous.translate);
  else element.style.removeProperty("translate");

  if (previous.x) element.style.setProperty(STUDIO_OFFSET_X_PROP, previous.x);
  else element.style.removeProperty(STUDIO_OFFSET_X_PROP);

  if (previous.y) element.style.setProperty(STUDIO_OFFSET_Y_PROP, previous.y);
  else element.style.removeProperty(STUDIO_OFFSET_Y_PROP);

  restoreAttribute(element, STUDIO_PATH_OFFSET_ATTR, previous.marker);
  restoreAttribute(element, STUDIO_ORIGINAL_TRANSLATE_ATTR, previous.originalTranslate);
  restoreAttribute(
    element,
    STUDIO_ORIGINAL_INLINE_TRANSLATE_ATTR,
    previous.originalInlineTranslate,
  );
}

function markWrapped(fn: (...args: unknown[]) => unknown): void {
  try {
    Object.defineProperty(fn, STUDIO_MANUAL_EDITS_WRAPPED_PROP, {
      configurable: false,
      enumerable: false,
      value: true,
    });
  } catch {
    try {
      (fn as unknown as Record<string, unknown>)[STUDIO_MANUAL_EDITS_WRAPPED_PROP] = true;
    } catch {
      // Ignore non-extensible functions.
    }
  }
}

function isWrapped(fn: (...args: unknown[]) => unknown): boolean {
  return Boolean((fn as unknown as Record<string, unknown>)[STUDIO_MANUAL_EDITS_WRAPPED_PROP]);
}

function wrapSeekReapplyFunction(
  win: StudioManualEditSeekWindow,
  owner: Record<string, unknown> | undefined,
  key: string,
): boolean {
  const fn = owner?.[key];
  if (!owner || typeof fn !== "function") return false;
  const seek = fn as (...args: unknown[]) => unknown;
  if (isWrapped(seek)) return true;

  const wrappedSeek = function (this: unknown, ...args: unknown[]): unknown {
    const result = seek.apply(this, args);
    win.__hfStudioManualEditsApply?.();
    return result;
  };
  markWrapped(wrappedSeek);
  owner[key] = wrappedSeek;
  return true;
}

function readOwnerNumber(owner: Record<string, unknown>, key: string): number | null {
  const fn = owner[key];
  if (typeof fn !== "function") return null;
  try {
    return finiteNumber(fn.call(owner));
  } catch {
    return null;
  }
}

function hasRemainingTimelineTime(owner: Record<string, unknown>): boolean {
  const duration = readOwnerNumber(owner, "duration") ?? readOwnerNumber(owner, "getDuration");
  if (duration == null) return true;
  if (duration <= 0) return false;

  const time =
    readOwnerNumber(owner, "time") ??
    readOwnerNumber(owner, "totalTime") ??
    readOwnerNumber(owner, "getTime");
  if (time == null) return true;
  return time < duration;
}

function isTimelinePlaying(owner: Record<string, unknown> | undefined): boolean {
  if (!owner) return false;
  const isPlaying = owner.isPlaying;
  if (typeof isPlaying === "function") {
    try {
      return Boolean(isPlaying.call(owner));
    } catch {
      return false;
    }
  }

  const paused = owner.paused;
  if (typeof paused === "function") {
    try {
      if (paused.call(owner)) return false;
    } catch {
      return false;
    }

    const isActive = owner.isActive;
    if (typeof isActive === "function") {
      try {
        if (isActive.call(owner)) return true;
      } catch {
        return false;
      }
    }

    return hasRemainingTimelineTime(owner);
  }

  const isActive = owner.isActive;
  if (typeof isActive === "function") {
    try {
      return Boolean(isActive.call(owner));
    } catch {
      return false;
    }
  }

  return false;
}

function isStudioManualEditPlaybackActive(win: StudioManualEditSeekWindow): boolean {
  if (isTimelinePlaying(win.__player)) return true;
  if (isTimelinePlaying(win.__timeline)) return true;
  return Object.values(win.__timelines ?? {}).some(isTimelinePlaying);
}

function startStudioManualEditPlaybackReapply(win: StudioManualEditSeekWindow): void {
  win.__hfStudioManualEditsApply?.();
  if (win[STUDIO_MANUAL_EDITS_PLAYBACK_FRAME_PROP] != null) return;

  const tick = () => {
    win.__hfStudioManualEditsApply?.();
    if (!isStudioManualEditPlaybackActive(win)) {
      win[STUDIO_MANUAL_EDITS_PLAYBACK_FRAME_PROP] = null;
      return;
    }
    win[STUDIO_MANUAL_EDITS_PLAYBACK_FRAME_PROP] = win.requestAnimationFrame(tick);
  };

  win[STUDIO_MANUAL_EDITS_PLAYBACK_FRAME_PROP] = win.requestAnimationFrame(tick);
}

function wrapPlayReapplyFunction(
  win: StudioManualEditSeekWindow,
  owner: Record<string, unknown> | undefined,
  key: string,
): boolean {
  const fn = owner?.[key];
  if (!owner || typeof fn !== "function") return false;
  const play = fn as (...args: unknown[]) => unknown;
  if (isWrapped(play)) return true;

  const wrappedPlay = function (this: unknown, ...args: unknown[]): unknown {
    const result = play.apply(this, args);
    startStudioManualEditPlaybackReapply(win);
    return result;
  };
  markWrapped(wrappedPlay);
  owner[key] = wrappedPlay;
  return true;
}

function wrapApplyAfterFunction(
  win: StudioManualEditSeekWindow,
  owner: Record<string, unknown> | undefined,
  key: string,
): boolean {
  const fn = owner?.[key];
  if (!owner || typeof fn !== "function") return false;
  const applyAfter = fn as (...args: unknown[]) => unknown;
  if (isWrapped(applyAfter)) return true;

  const wrappedApplyAfter = function (this: unknown, ...args: unknown[]): unknown {
    const result = applyAfter.apply(this, args);
    win.__hfStudioManualEditsApply?.();
    return result;
  };
  markWrapped(wrappedApplyAfter);
  owner[key] = wrappedApplyAfter;
  return true;
}

export function installStudioManualEditSeekReapply(win: Window, apply: () => void): boolean {
  const studioWin = win as StudioManualEditSeekWindow;
  studioWin[STUDIO_MANUAL_EDITS_APPLY_PROP] = apply;

  const wrappedHfSeek = wrapSeekReapplyFunction(studioWin, studioWin.__hf, "seek");
  const wrappedPlayerSeek = wrapSeekReapplyFunction(studioWin, studioWin.__player, "seek");
  const wrappedPlayerRenderSeek = wrapSeekReapplyFunction(
    studioWin,
    studioWin.__player,
    "renderSeek",
  );
  const wrappedTimelineSeek = wrapSeekReapplyFunction(studioWin, studioWin.__timeline, "seek");
  const wrappedPlayerPlay = wrapPlayReapplyFunction(studioWin, studioWin.__player, "play");
  const wrappedTimelinePlay = wrapPlayReapplyFunction(studioWin, studioWin.__timeline, "play");
  const wrappedPlayerPause = wrapApplyAfterFunction(studioWin, studioWin.__player, "pause");
  const wrappedTimelinePause = wrapApplyAfterFunction(studioWin, studioWin.__timeline, "pause");
  let wrappedNamedTimelineSeek = false;
  let wrappedNamedTimelinePlay = false;
  let wrappedNamedTimelinePause = false;
  for (const timeline of Object.values(studioWin.__timelines ?? {})) {
    wrappedNamedTimelineSeek =
      wrapSeekReapplyFunction(studioWin, timeline, "seek") || wrappedNamedTimelineSeek;
    wrappedNamedTimelinePlay =
      wrapPlayReapplyFunction(studioWin, timeline, "play") || wrappedNamedTimelinePlay;
    wrappedNamedTimelinePause =
      wrapApplyAfterFunction(studioWin, timeline, "pause") || wrappedNamedTimelinePause;
  }

  if (isStudioManualEditPlaybackActive(studioWin)) {
    startStudioManualEditPlaybackReapply(studioWin);
  }

  return (
    wrappedHfSeek ||
    wrappedPlayerSeek ||
    wrappedPlayerRenderSeek ||
    wrappedTimelineSeek ||
    wrappedPlayerPlay ||
    wrappedTimelinePlay ||
    wrappedPlayerPause ||
    wrappedTimelinePause ||
    wrappedNamedTimelineSeek ||
    wrappedNamedTimelinePlay ||
    wrappedNamedTimelinePause
  );
}

function getManualEditSourceFileForElement(
  el: HTMLElement,
  activeCompositionPath: string | null,
): string {
  let current: HTMLElement | null = el;
  while (current) {
    const sourceFile =
      current.getAttribute("data-composition-file") ?? current.getAttribute("data-composition-src");
    if (sourceFile) return sourceFile;
    current = current.parentElement;
  }
  return activeCompositionPath ?? "index.html";
}

function elementMatchesManualEditSourceFile(
  element: HTMLElement,
  sourceFile: string,
  activeCompositionPath: string | null,
): boolean {
  return getManualEditSourceFileForElement(element, activeCompositionPath) === sourceFile;
}

function queryManualEditSelectorCandidates(
  doc: Document,
  selector: string,
  htmlElement: typeof HTMLElement,
): HTMLElement[] {
  const isCandidate = (element: Element): element is HTMLElement => element instanceof htmlElement;

  const className = selector.match(/^\.([A-Za-z0-9_-]+)$/)?.[1];
  if (className) {
    return Array.from(doc.getElementsByTagName("*")).filter(
      (element): element is HTMLElement =>
        isCandidate(element) && element.classList.contains(className),
    );
  }

  if (/^[A-Za-z][A-Za-z0-9-]*$/.test(selector)) {
    return Array.from(doc.getElementsByTagName(selector)).filter(isCandidate);
  }

  return Array.from(doc.querySelectorAll(selector)).filter(isCandidate);
}

function resolveManualEditTarget(
  doc: Document,
  edit: StudioManualEdit,
  activeCompositionPath: string | null,
): HTMLElement | null {
  const htmlElement = doc.defaultView?.HTMLElement;
  if (!htmlElement) return null;

  if (edit.target.id) {
    const byId = doc.getElementById(edit.target.id);
    if (
      byId instanceof htmlElement &&
      elementMatchesManualEditSourceFile(byId, edit.target.sourceFile, activeCompositionPath)
    ) {
      return byId;
    }

    const matchesById = [doc.documentElement, ...Array.from(doc.getElementsByTagName("*"))].filter(
      (element): element is HTMLElement =>
        element instanceof htmlElement &&
        element.id === edit.target.id &&
        elementMatchesManualEditSourceFile(element, edit.target.sourceFile, activeCompositionPath),
    );
    if (matchesById[0]) return matchesById[0];
  }

  if (!edit.target.selector) return null;
  try {
    const matches = queryManualEditSelectorCandidates(
      doc,
      edit.target.selector,
      htmlElement,
    ).filter((element) =>
      elementMatchesManualEditSourceFile(element, edit.target.sourceFile, activeCompositionPath),
    );
    return matches[edit.target.selectorIndex ?? 0] ?? null;
  } catch {
    return null;
  }
}

function collectStudioManualEditElements(doc: Document): HTMLElement[] {
  const htmlElement = doc.defaultView?.HTMLElement;
  if (!htmlElement) return [];

  const elements = [doc.documentElement, ...Array.from(doc.getElementsByTagName("*"))].filter(
    (element): element is HTMLElement => element instanceof htmlElement,
  );

  return elements.filter(
    (element) =>
      element.hasAttribute(STUDIO_PATH_OFFSET_ATTR) ||
      element.hasAttribute(STUDIO_MANUAL_EDIT_GESTURE_ATTR) ||
      element.hasAttribute(STUDIO_BOX_SIZE_ATTR) ||
      element.hasAttribute(STUDIO_ROTATION_ATTR) ||
      element.hasAttribute(STUDIO_ROTATION_DRAFT_ATTR) ||
      element.hasAttribute(STUDIO_ORIGINAL_TRANSLATE_ATTR) ||
      element.hasAttribute(STUDIO_ORIGINAL_INLINE_TRANSLATE_ATTR) ||
      element.hasAttribute(STUDIO_ORIGINAL_MIN_WIDTH_ATTR) ||
      element.hasAttribute(STUDIO_ORIGINAL_FLEX_BASIS_ATTR) ||
      element.hasAttribute(STUDIO_ORIGINAL_SCALE_ATTR) ||
      element.hasAttribute(STUDIO_ORIGINAL_ROTATE_ATTR) ||
      element.hasAttribute(STUDIO_ORIGINAL_INLINE_ROTATE_ATTR) ||
      Boolean(element.style.getPropertyValue(STUDIO_OFFSET_X_PROP)) ||
      Boolean(element.style.getPropertyValue(STUDIO_OFFSET_Y_PROP)) ||
      Boolean(element.style.getPropertyValue(STUDIO_WIDTH_PROP)) ||
      Boolean(element.style.getPropertyValue(STUDIO_HEIGHT_PROP)) ||
      Boolean(element.style.getPropertyValue(STUDIO_ROTATION_PROP)),
  );
}

export function applyStudioManualEditManifest(
  doc: Document,
  manifest: StudioManualEditManifest,
  activeCompositionPath: string | null,
): number {
  const resolvedEdits: Array<{ edit: StudioManualEdit; element: HTMLElement }> = [];
  const pathOffsetTargets = new Set<HTMLElement>();
  const boxSizeTargets = new Set<HTMLElement>();
  const rotationTargets = new Set<HTMLElement>();

  for (const edit of manifest.edits) {
    const element = resolveManualEditTarget(doc, edit, activeCompositionPath);
    if (!element) continue;
    if (isStudioManualEditGestureActive(element)) {
      continue;
    }
    resolvedEdits.push({ edit, element });
    if (edit.kind === "path-offset") pathOffsetTargets.add(element);
    if (edit.kind === "box-size") boxSizeTargets.add(element);
    if (edit.kind === "rotation") rotationTargets.add(element);
  }

  for (const element of collectStudioManualEditElements(doc)) {
    if (isStudioManualEditGestureActive(element)) continue;
    if (!pathOffsetTargets.has(element)) {
      clearStudioPathOffset(element);
    }
    if (!boxSizeTargets.has(element)) {
      clearStudioBoxSize(element);
    }
    if (!rotationTargets.has(element)) {
      clearStudioRotation(element);
    }
  }

  let applied = 0;
  for (const { edit, element } of resolvedEdits) {
    if (edit.kind === "path-offset") {
      applyStudioPathOffset(element, { x: edit.x, y: edit.y });
    } else if (edit.kind === "box-size") {
      applyStudioBoxSize(element, { width: edit.width, height: edit.height });
    } else {
      applyStudioRotation(element, { angle: edit.angle });
    }
    applied += 1;
  }
  return applied;
}
