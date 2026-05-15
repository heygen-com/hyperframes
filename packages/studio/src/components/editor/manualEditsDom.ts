import {
  STUDIO_OFFSET_X_PROP,
  STUDIO_OFFSET_Y_PROP,
  STUDIO_WIDTH_PROP,
  STUDIO_HEIGHT_PROP,
  STUDIO_ROTATION_PROP,
  STUDIO_PATH_OFFSET_ATTR,
  STUDIO_MANUAL_EDIT_GESTURE_ATTR,
  STUDIO_BOX_SIZE_ATTR,
  STUDIO_ROTATION_ATTR,
  STUDIO_ORIGINAL_TRANSLATE_ATTR,
  STUDIO_ORIGINAL_INLINE_TRANSLATE_ATTR,
  STUDIO_ORIGINAL_WIDTH_ATTR,
  STUDIO_ORIGINAL_HEIGHT_ATTR,
  STUDIO_ORIGINAL_MIN_WIDTH_ATTR,
  STUDIO_ORIGINAL_MIN_HEIGHT_ATTR,
  STUDIO_ORIGINAL_MAX_WIDTH_ATTR,
  STUDIO_ORIGINAL_MAX_HEIGHT_ATTR,
  STUDIO_ORIGINAL_FLEX_BASIS_ATTR,
  STUDIO_ORIGINAL_FLEX_GROW_ATTR,
  STUDIO_ORIGINAL_FLEX_SHRINK_ATTR,
  STUDIO_ORIGINAL_BOX_SIZING_ATTR,
  STUDIO_ORIGINAL_SCALE_ATTR,
  STUDIO_ORIGINAL_TRANSFORM_ORIGIN_ATTR,
  STUDIO_ORIGINAL_DISPLAY_ATTR,
  STUDIO_ORIGINAL_ROTATE_ATTR,
  STUDIO_ORIGINAL_INLINE_ROTATE_ATTR,
  STUDIO_ORIGINAL_ROTATION_TRANSFORM_ORIGIN_ATTR,
  STUDIO_ROTATION_DRAFT_ATTR,
  STUDIO_ORIGINAL_TRANSFORM_DISPLAY_ATTR,
  STUDIO_ROTATION_TRANSFORM_ORIGIN,
} from "./manualEditsTypes";
import { roundRotationAngle } from "./manualEditsParsing";
import {
  STUDIO_MOTION_ATTR,
  STUDIO_MOTION_ORIGINAL_TRANSFORM_ATTR,
  STUDIO_MOTION_ORIGINAL_OPACITY_ATTR,
  STUDIO_MOTION_ORIGINAL_VISIBILITY_ATTR,
} from "./studioMotionTypes";
import { applyStudioMotionFromDom } from "./studioMotion";

/* ── Gesture tracking ─────────────────────────────────────────────── */
let studioManualEditGestureId = 0;

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

export function isStudioManualEditGestureActive(element: HTMLElement): boolean {
  return element.hasAttribute(STUDIO_MANUAL_EDIT_GESTURE_ATTR);
}

export function isStudioManualEditGestureCurrent(element: HTMLElement, token: string): boolean {
  return element.getAttribute(STUDIO_MANUAL_EDIT_GESTURE_ATTR) === token;
}

/* ── CSS custom-property readers ──────────────────────────────────── */
function readPxCustomProperty(element: HTMLElement, property: string): number {
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
  const value = Number.parseFloat(element.style.getPropertyValue(STUDIO_ROTATION_PROP));
  return { angle: Number.isFinite(value) ? value : 0 };
}

/* ── Internal style helpers ───────────────────────────────────────── */
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

function readTransformLonghandBase(element: HTMLElement, property: "translate" | "rotate"): string {
  const value = readStyleOrComputed(element, property).trim();
  return value === "none" ? "" : value;
}

export function styleUsesStudioOffset(value: string): boolean {
  return value.includes(STUDIO_OFFSET_X_PROP) || value.includes(STUDIO_OFFSET_Y_PROP);
}

export function styleUsesStudioSize(value: string): boolean {
  return value.includes(STUDIO_WIDTH_PROP) || value.includes(STUDIO_HEIGHT_PROP);
}

export function styleUsesStudioRotation(value: string): boolean {
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

/* ── Inline promotion ─────────────────────────────────────────────── */
function promoteInlineForTransform(element: HTMLElement): void {
  const computedDisplay = safeComputedStyleProperty(element, "display");
  if (computedDisplay !== "inline") return;
  if (!element.hasAttribute(STUDIO_ORIGINAL_TRANSFORM_DISPLAY_ATTR)) {
    element.setAttribute(
      STUDIO_ORIGINAL_TRANSFORM_DISPLAY_ATTR,
      element.style.getPropertyValue("display"),
    );
  }
  element.style.setProperty("display", "inline-block");
}

export function restoreInlineDisplay(element: HTMLElement): void {
  const original = element.getAttribute(STUDIO_ORIGINAL_TRANSFORM_DISPLAY_ATTR);
  if (original == null) return;
  if (original === "") element.style.removeProperty("display");
  else element.style.setProperty("display", original);
  element.removeAttribute(STUDIO_ORIGINAL_TRANSFORM_DISPLAY_ATTR);
}

/* ── Translate helpers ────────────────────────────────────────────── */
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

/* ── Path offset apply ────────────────────────────────────────────── */

// GSAP 3.x reads the resolved CSS `translate` individual property at initialization and bakes it
// into element.style.transform (as a matrix) on every seek. When the studio's reapply hook also
// writes `translate`, both properties compose additively, doubling the visual offset. This helper
// zeroes out only the translate component (m41/m42) so the `translate` prop isn't double-counted.
function stripGsapTranslateFromTransform(element: HTMLElement): void {
  const transform = element.style.getPropertyValue("transform");
  if (!transform || transform === "none") return;
  const win = element.ownerDocument.defaultView as (Window & typeof globalThis) | null;
  const DOMMatrixCtor = (win as unknown as { DOMMatrix?: typeof DOMMatrix })?.DOMMatrix;
  if (!DOMMatrixCtor) return;
  try {
    const m = new DOMMatrixCtor(transform);
    if (m.m41 === 0 && m.m42 === 0) return;
    m.m41 = 0;
    m.m42 = 0;
    if (m.is2D && m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1) {
      element.style.removeProperty("transform");
    } else {
      element.style.setProperty("transform", m.toString());
    }
  } catch {
    // non-parseable transform or DOMMatrix unavailable — leave as-is
  }
}

export function applyStudioPathOffset(
  element: HTMLElement,
  offset: { x: number; y: number },
  options: { updateBase?: boolean } = {},
): void {
  promoteInlineForTransform(element);
  writeStudioPathOffsetVars(element, offset, { updateBase: options.updateBase ?? true });
  element.style.setProperty(
    "translate",
    composeTranslateValue(
      element,
      `var(${STUDIO_OFFSET_X_PROP}, 0px)`,
      `var(${STUDIO_OFFSET_Y_PROP}, 0px)`,
    ),
  );
  stripGsapTranslateFromTransform(element);
}

export function applyStudioPathOffsetDraft(
  element: HTMLElement,
  offset: { x: number; y: number },
): void {
  promoteInlineForTransform(element);
  writeStudioPathOffsetVars(element, offset, { updateBase: false });
  element.style.setProperty(
    "translate",
    composeTranslateValue(element, `${Math.round(offset.x)}px`, `${Math.round(offset.y)}px`),
  );
  stripGsapTranslateFromTransform(element);
}

/* ── Box size apply ───────────────────────────────────────────────── */
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
  const origScale = element.getAttribute(STUDIO_ORIGINAL_SCALE_ATTR);
  if (origScale == null || origScale === "") element.style.removeProperty("scale");
  else element.style.setProperty("scale", origScale);
  element.removeAttribute(STUDIO_ORIGINAL_SCALE_ATTR);
  const origOrigin = element.getAttribute(STUDIO_ORIGINAL_TRANSFORM_ORIGIN_ATTR);
  if (origOrigin == null || origOrigin === "") element.style.removeProperty("transform-origin");
  else element.style.setProperty("transform-origin", origOrigin);
  element.removeAttribute(STUDIO_ORIGINAL_TRANSFORM_ORIGIN_ATTR);
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

export function applyStudioBoxSize(
  element: HTMLElement,
  size: { width: number; height: number },
): void {
  promoteInlineForTransform(element);
  applyStudioBoxSizeDimensions(element, size);
}

export function applyStudioBoxSizeDraft(
  element: HTMLElement,
  size: { width: number; height: number },
): void {
  promoteInlineForTransform(element);
  applyStudioBoxSizeDimensions(element, size);
}

/* ── Rotation apply ───────────────────────────────────────────────── */
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

export function applyStudioRotation(element: HTMLElement, rotation: { angle: number }): void {
  promoteInlineForTransform(element);
  writeStudioRotationVars(element, rotation);
  element.removeAttribute(STUDIO_ROTATION_DRAFT_ATTR);
  element.style.setProperty(
    "rotate",
    composeStudioRotationValue(element, `var(${STUDIO_ROTATION_PROP}, 0deg)`),
  );
}

export function applyStudioRotationDraft(element: HTMLElement, rotation: { angle: number }): void {
  promoteInlineForTransform(element);
  writeStudioRotationVars(element, rotation, { updateBase: false });
  element.setAttribute(STUDIO_ROTATION_DRAFT_ATTR, "true");
  element.style.setProperty(
    "rotate",
    composeStudioRotationValue(element, `${roundRotationAngle(rotation.angle)}deg`),
  );
}

// Clear functions live in manualEditsSnapshot.ts (they depend on restoreInline* helpers).
export {
  clearStudioPathOffset,
  clearStudioRotation,
  clearStudioBoxSize,
} from "./manualEditsSnapshot";

/* ── HTML patch builders ──────────────────────────────────────────── */
import type { PatchOperation } from "../../utils/sourcePatcher";

export function buildPathOffsetPatches(element: HTMLElement): PatchOperation[] {
  const x = element.style.getPropertyValue(STUDIO_OFFSET_X_PROP);
  const y = element.style.getPropertyValue(STUDIO_OFFSET_Y_PROP);
  const translate = element.style.getPropertyValue("translate");
  const originalTranslate = element.getAttribute(STUDIO_ORIGINAL_TRANSLATE_ATTR);
  const originalInlineTranslate = element.getAttribute(STUDIO_ORIGINAL_INLINE_TRANSLATE_ATTR);
  const displayVal = element.style.getPropertyValue("display");
  const transformDisplayAttr = element.getAttribute(STUDIO_ORIGINAL_TRANSFORM_DISPLAY_ATTR);
  const ops: PatchOperation[] = [];
  if (x) ops.push({ type: "inline-style", property: STUDIO_OFFSET_X_PROP, value: x });
  if (y) ops.push({ type: "inline-style", property: STUDIO_OFFSET_Y_PROP, value: y });
  if (translate) ops.push({ type: "inline-style", property: "translate", value: translate });
  ops.push({ type: "attribute", property: STUDIO_PATH_OFFSET_ATTR, value: "true" });
  if (originalTranslate !== null)
    ops.push({
      type: "attribute",
      property: STUDIO_ORIGINAL_TRANSLATE_ATTR,
      value: originalTranslate,
    });
  if (originalInlineTranslate !== null)
    ops.push({
      type: "attribute",
      property: STUDIO_ORIGINAL_INLINE_TRANSLATE_ATTR,
      value: originalInlineTranslate,
    });
  if (displayVal) ops.push({ type: "inline-style", property: "display", value: displayVal });
  if (transformDisplayAttr !== null)
    ops.push({
      type: "attribute",
      property: STUDIO_ORIGINAL_TRANSFORM_DISPLAY_ATTR,
      value: transformDisplayAttr,
    });
  return ops;
}

export function buildClearPathOffsetPatches(element: HTMLElement): PatchOperation[] {
  const originalInlineTranslate = element.getAttribute(STUDIO_ORIGINAL_INLINE_TRANSLATE_ATTR);
  const ops: PatchOperation[] = [
    { type: "inline-style", property: STUDIO_OFFSET_X_PROP, value: null },
    { type: "inline-style", property: STUDIO_OFFSET_Y_PROP, value: null },
    {
      type: "inline-style",
      property: "translate",
      value: originalInlineTranslate || null,
    },
    { type: "attribute", property: STUDIO_PATH_OFFSET_ATTR, value: null },
    { type: "attribute", property: STUDIO_ORIGINAL_TRANSLATE_ATTR, value: null },
    { type: "attribute", property: STUDIO_ORIGINAL_INLINE_TRANSLATE_ATTR, value: null },
  ];
  const origDisplay = element.getAttribute(STUDIO_ORIGINAL_TRANSFORM_DISPLAY_ATTR);
  if (origDisplay !== null) {
    ops.push({ type: "inline-style", property: "display", value: origDisplay || null });
    ops.push({ type: "attribute", property: STUDIO_ORIGINAL_TRANSFORM_DISPLAY_ATTR, value: null });
  }
  return ops;
}

export function buildBoxSizePatches(element: HTMLElement): PatchOperation[] {
  const ops: PatchOperation[] = [];

  const studioWidth = element.style.getPropertyValue(STUDIO_WIDTH_PROP);
  const studioHeight = element.style.getPropertyValue(STUDIO_HEIGHT_PROP);
  if (studioWidth)
    ops.push({ type: "inline-style", property: STUDIO_WIDTH_PROP, value: studioWidth });
  if (studioHeight)
    ops.push({ type: "inline-style", property: STUDIO_HEIGHT_PROP, value: studioHeight });

  const width = element.style.getPropertyValue("width");
  const height = element.style.getPropertyValue("height");
  const minWidth = element.style.getPropertyValue("min-width");
  const minHeight = element.style.getPropertyValue("min-height");
  const maxWidth = element.style.getPropertyValue("max-width");
  const maxHeight = element.style.getPropertyValue("max-height");
  const flexBasis = element.style.getPropertyValue("flex-basis");
  const flexGrow = element.style.getPropertyValue("flex-grow");
  const flexShrink = element.style.getPropertyValue("flex-shrink");
  const boxSizing = element.style.getPropertyValue("box-sizing");
  const scale = element.style.getPropertyValue("scale");
  const transformOrigin = element.style.getPropertyValue("transform-origin");
  const displayVal = element.style.getPropertyValue("display");

  if (width) ops.push({ type: "inline-style", property: "width", value: width });
  if (height) ops.push({ type: "inline-style", property: "height", value: height });
  if (minWidth) ops.push({ type: "inline-style", property: "min-width", value: minWidth });
  if (minHeight) ops.push({ type: "inline-style", property: "min-height", value: minHeight });
  if (maxWidth) ops.push({ type: "inline-style", property: "max-width", value: maxWidth });
  if (maxHeight) ops.push({ type: "inline-style", property: "max-height", value: maxHeight });
  if (flexBasis) ops.push({ type: "inline-style", property: "flex-basis", value: flexBasis });
  if (flexGrow) ops.push({ type: "inline-style", property: "flex-grow", value: flexGrow });
  if (flexShrink) ops.push({ type: "inline-style", property: "flex-shrink", value: flexShrink });
  if (boxSizing) ops.push({ type: "inline-style", property: "box-sizing", value: boxSizing });
  if (scale) ops.push({ type: "inline-style", property: "scale", value: scale });
  if (transformOrigin)
    ops.push({ type: "inline-style", property: "transform-origin", value: transformOrigin });
  if (displayVal) ops.push({ type: "inline-style", property: "display", value: displayVal });

  ops.push({ type: "attribute", property: STUDIO_BOX_SIZE_ATTR, value: "true" });

  const origWidth = element.getAttribute(STUDIO_ORIGINAL_WIDTH_ATTR);
  const origHeight = element.getAttribute(STUDIO_ORIGINAL_HEIGHT_ATTR);
  const origMinWidth = element.getAttribute(STUDIO_ORIGINAL_MIN_WIDTH_ATTR);
  const origMinHeight = element.getAttribute(STUDIO_ORIGINAL_MIN_HEIGHT_ATTR);
  const origMaxWidth = element.getAttribute(STUDIO_ORIGINAL_MAX_WIDTH_ATTR);
  const origMaxHeight = element.getAttribute(STUDIO_ORIGINAL_MAX_HEIGHT_ATTR);
  const origFlexBasis = element.getAttribute(STUDIO_ORIGINAL_FLEX_BASIS_ATTR);
  const origFlexGrow = element.getAttribute(STUDIO_ORIGINAL_FLEX_GROW_ATTR);
  const origFlexShrink = element.getAttribute(STUDIO_ORIGINAL_FLEX_SHRINK_ATTR);
  const origBoxSizing = element.getAttribute(STUDIO_ORIGINAL_BOX_SIZING_ATTR);
  const origScale = element.getAttribute(STUDIO_ORIGINAL_SCALE_ATTR);
  const origTransformOrigin = element.getAttribute(STUDIO_ORIGINAL_TRANSFORM_ORIGIN_ATTR);
  const origDisplay = element.getAttribute(STUDIO_ORIGINAL_DISPLAY_ATTR);
  const origTransformDisplay = element.getAttribute(STUDIO_ORIGINAL_TRANSFORM_DISPLAY_ATTR);

  if (origWidth !== null)
    ops.push({ type: "attribute", property: STUDIO_ORIGINAL_WIDTH_ATTR, value: origWidth });
  if (origHeight !== null)
    ops.push({ type: "attribute", property: STUDIO_ORIGINAL_HEIGHT_ATTR, value: origHeight });
  if (origMinWidth !== null)
    ops.push({ type: "attribute", property: STUDIO_ORIGINAL_MIN_WIDTH_ATTR, value: origMinWidth });
  if (origMinHeight !== null)
    ops.push({
      type: "attribute",
      property: STUDIO_ORIGINAL_MIN_HEIGHT_ATTR,
      value: origMinHeight,
    });
  if (origMaxWidth !== null)
    ops.push({ type: "attribute", property: STUDIO_ORIGINAL_MAX_WIDTH_ATTR, value: origMaxWidth });
  if (origMaxHeight !== null)
    ops.push({
      type: "attribute",
      property: STUDIO_ORIGINAL_MAX_HEIGHT_ATTR,
      value: origMaxHeight,
    });
  if (origFlexBasis !== null)
    ops.push({
      type: "attribute",
      property: STUDIO_ORIGINAL_FLEX_BASIS_ATTR,
      value: origFlexBasis,
    });
  if (origFlexGrow !== null)
    ops.push({ type: "attribute", property: STUDIO_ORIGINAL_FLEX_GROW_ATTR, value: origFlexGrow });
  if (origFlexShrink !== null)
    ops.push({
      type: "attribute",
      property: STUDIO_ORIGINAL_FLEX_SHRINK_ATTR,
      value: origFlexShrink,
    });
  if (origBoxSizing !== null)
    ops.push({
      type: "attribute",
      property: STUDIO_ORIGINAL_BOX_SIZING_ATTR,
      value: origBoxSizing,
    });
  if (origScale !== null)
    ops.push({ type: "attribute", property: STUDIO_ORIGINAL_SCALE_ATTR, value: origScale });
  if (origTransformOrigin !== null)
    ops.push({
      type: "attribute",
      property: STUDIO_ORIGINAL_TRANSFORM_ORIGIN_ATTR,
      value: origTransformOrigin,
    });
  if (origDisplay !== null)
    ops.push({ type: "attribute", property: STUDIO_ORIGINAL_DISPLAY_ATTR, value: origDisplay });
  if (origTransformDisplay !== null)
    ops.push({
      type: "attribute",
      property: STUDIO_ORIGINAL_TRANSFORM_DISPLAY_ATTR,
      value: origTransformDisplay,
    });

  return ops;
}

export function buildClearBoxSizePatches(element: HTMLElement): PatchOperation[] {
  const ops: PatchOperation[] = [
    { type: "inline-style", property: STUDIO_WIDTH_PROP, value: null },
    { type: "inline-style", property: STUDIO_HEIGHT_PROP, value: null },
    { type: "attribute", property: STUDIO_BOX_SIZE_ATTR, value: null },
  ];

  const origAttrs: Array<[string, string]> = [
    [STUDIO_ORIGINAL_WIDTH_ATTR, "width"],
    [STUDIO_ORIGINAL_HEIGHT_ATTR, "height"],
    [STUDIO_ORIGINAL_MIN_WIDTH_ATTR, "min-width"],
    [STUDIO_ORIGINAL_MIN_HEIGHT_ATTR, "min-height"],
    [STUDIO_ORIGINAL_MAX_WIDTH_ATTR, "max-width"],
    [STUDIO_ORIGINAL_MAX_HEIGHT_ATTR, "max-height"],
    [STUDIO_ORIGINAL_FLEX_BASIS_ATTR, "flex-basis"],
    [STUDIO_ORIGINAL_FLEX_GROW_ATTR, "flex-grow"],
    [STUDIO_ORIGINAL_FLEX_SHRINK_ATTR, "flex-shrink"],
    [STUDIO_ORIGINAL_BOX_SIZING_ATTR, "box-sizing"],
    [STUDIO_ORIGINAL_SCALE_ATTR, "scale"],
    [STUDIO_ORIGINAL_TRANSFORM_ORIGIN_ATTR, "transform-origin"],
    [STUDIO_ORIGINAL_DISPLAY_ATTR, "display"],
  ];

  for (const [attrName, styleProp] of origAttrs) {
    const origVal = element.getAttribute(attrName);
    if (origVal !== null) {
      ops.push({ type: "inline-style", property: styleProp, value: origVal || null });
    }
    ops.push({ type: "attribute", property: attrName, value: null });
  }

  const origTransformDisplay = element.getAttribute(STUDIO_ORIGINAL_TRANSFORM_DISPLAY_ATTR);
  if (origTransformDisplay !== null) {
    ops.push({ type: "inline-style", property: "display", value: origTransformDisplay || null });
    ops.push({ type: "attribute", property: STUDIO_ORIGINAL_TRANSFORM_DISPLAY_ATTR, value: null });
  }

  return ops;
}

export function buildRotationPatches(element: HTMLElement): PatchOperation[] {
  const ops: PatchOperation[] = [];

  const studioRotation = element.style.getPropertyValue(STUDIO_ROTATION_PROP);
  const rotate = element.style.getPropertyValue("rotate");
  const transformOrigin = element.style.getPropertyValue("transform-origin");
  const displayVal = element.style.getPropertyValue("display");

  if (studioRotation)
    ops.push({ type: "inline-style", property: STUDIO_ROTATION_PROP, value: studioRotation });
  if (rotate) ops.push({ type: "inline-style", property: "rotate", value: rotate });
  if (transformOrigin)
    ops.push({ type: "inline-style", property: "transform-origin", value: transformOrigin });
  if (displayVal) ops.push({ type: "inline-style", property: "display", value: displayVal });

  ops.push({ type: "attribute", property: STUDIO_ROTATION_ATTR, value: "true" });

  const origRotate = element.getAttribute(STUDIO_ORIGINAL_ROTATE_ATTR);
  const origInlineRotate = element.getAttribute(STUDIO_ORIGINAL_INLINE_ROTATE_ATTR);
  const origRotationTransformOrigin = element.getAttribute(
    STUDIO_ORIGINAL_ROTATION_TRANSFORM_ORIGIN_ATTR,
  );
  const origTransformDisplay = element.getAttribute(STUDIO_ORIGINAL_TRANSFORM_DISPLAY_ATTR);

  if (origRotate !== null)
    ops.push({ type: "attribute", property: STUDIO_ORIGINAL_ROTATE_ATTR, value: origRotate });
  if (origInlineRotate !== null)
    ops.push({
      type: "attribute",
      property: STUDIO_ORIGINAL_INLINE_ROTATE_ATTR,
      value: origInlineRotate,
    });
  if (origRotationTransformOrigin !== null)
    ops.push({
      type: "attribute",
      property: STUDIO_ORIGINAL_ROTATION_TRANSFORM_ORIGIN_ATTR,
      value: origRotationTransformOrigin,
    });
  if (origTransformDisplay !== null)
    ops.push({
      type: "attribute",
      property: STUDIO_ORIGINAL_TRANSFORM_DISPLAY_ATTR,
      value: origTransformDisplay,
    });

  return ops;
}

export function buildClearRotationPatches(element: HTMLElement): PatchOperation[] {
  const origInlineRotate = element.getAttribute(STUDIO_ORIGINAL_INLINE_ROTATE_ATTR);
  const origRotationTransformOrigin = element.getAttribute(
    STUDIO_ORIGINAL_ROTATION_TRANSFORM_ORIGIN_ATTR,
  );
  const ops: PatchOperation[] = [
    { type: "inline-style", property: STUDIO_ROTATION_PROP, value: null },
    { type: "inline-style", property: "rotate", value: origInlineRotate || null },
    {
      type: "inline-style",
      property: "transform-origin",
      value: origRotationTransformOrigin !== null ? origRotationTransformOrigin || null : null,
    },
    { type: "attribute", property: STUDIO_ROTATION_ATTR, value: null },
    { type: "attribute", property: STUDIO_ROTATION_DRAFT_ATTR, value: null },
    { type: "attribute", property: STUDIO_ORIGINAL_ROTATE_ATTR, value: null },
    { type: "attribute", property: STUDIO_ORIGINAL_INLINE_ROTATE_ATTR, value: null },
    { type: "attribute", property: STUDIO_ORIGINAL_ROTATION_TRANSFORM_ORIGIN_ATTR, value: null },
  ];
  const origTransformDisplay = element.getAttribute(STUDIO_ORIGINAL_TRANSFORM_DISPLAY_ATTR);
  if (origTransformDisplay !== null) {
    ops.push({ type: "inline-style", property: "display", value: origTransformDisplay || null });
    ops.push({ type: "attribute", property: STUDIO_ORIGINAL_TRANSFORM_DISPLAY_ATTR, value: null });
  }
  return ops;
}

/* ── Motion HTML patch builders ──────────────────────────────────── */

export function buildMotionPatches(element: HTMLElement): PatchOperation[] {
  const motionJson = element.getAttribute(STUDIO_MOTION_ATTR);
  if (!motionJson) return [];
  const ops: PatchOperation[] = [
    { type: "attribute", property: STUDIO_MOTION_ATTR, value: motionJson },
  ];
  const origTransform = element.getAttribute(STUDIO_MOTION_ORIGINAL_TRANSFORM_ATTR);
  if (origTransform !== null) {
    ops.push({
      type: "attribute",
      property: STUDIO_MOTION_ORIGINAL_TRANSFORM_ATTR,
      value: origTransform,
    });
  }
  const origOpacity = element.getAttribute(STUDIO_MOTION_ORIGINAL_OPACITY_ATTR);
  if (origOpacity !== null) {
    ops.push({
      type: "attribute",
      property: STUDIO_MOTION_ORIGINAL_OPACITY_ATTR,
      value: origOpacity,
    });
  }
  const origVisibility = element.getAttribute(STUDIO_MOTION_ORIGINAL_VISIBILITY_ATTR);
  if (origVisibility !== null) {
    ops.push({
      type: "attribute",
      property: STUDIO_MOTION_ORIGINAL_VISIBILITY_ATTR,
      value: origVisibility,
    });
  }
  return ops;
}

export function buildClearMotionPatches(_element: HTMLElement): PatchOperation[] {
  return [
    { type: "attribute", property: STUDIO_MOTION_ATTR, value: null },
    { type: "attribute", property: STUDIO_MOTION_ORIGINAL_TRANSFORM_ATTR, value: null },
    { type: "attribute", property: STUDIO_MOTION_ORIGINAL_OPACITY_ATTR, value: null },
    { type: "attribute", property: STUDIO_MOTION_ORIGINAL_VISIBILITY_ATTR, value: null },
  ];
}

/* ── Seek reapply (position + motion) ────────────────────────────── */

export function reapplyPositionEditsAfterSeek(doc: Document): void {
  const htmlElement = doc.defaultView?.HTMLElement;
  if (!htmlElement) return;

  const offsetEls = Array.from(doc.querySelectorAll(`[${STUDIO_PATH_OFFSET_ATTR}="true"]`)).filter(
    (el): el is HTMLElement => el instanceof htmlElement,
  );
  for (const el of offsetEls) {
    const x = el.style.getPropertyValue(STUDIO_OFFSET_X_PROP);
    const y = el.style.getPropertyValue(STUDIO_OFFSET_Y_PROP);
    if (x || y) {
      applyStudioPathOffset(el, {
        x: Number.parseFloat(x) || 0,
        y: Number.parseFloat(y) || 0,
      });
    }
  }

  const boxSizeEls = Array.from(doc.querySelectorAll(`[${STUDIO_BOX_SIZE_ATTR}="true"]`)).filter(
    (el): el is HTMLElement => el instanceof htmlElement,
  );
  for (const el of boxSizeEls) {
    const w = Number.parseFloat(el.style.getPropertyValue(STUDIO_WIDTH_PROP));
    const h = Number.parseFloat(el.style.getPropertyValue(STUDIO_HEIGHT_PROP));
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      applyStudioBoxSize(el, { width: w, height: h });
    }
  }

  const rotationEls = Array.from(doc.querySelectorAll(`[${STUDIO_ROTATION_ATTR}="true"]`)).filter(
    (el): el is HTMLElement => el instanceof htmlElement,
  );
  for (const el of rotationEls) {
    const angle = Number.parseFloat(el.style.getPropertyValue(STUDIO_ROTATION_PROP));
    if (Number.isFinite(angle)) {
      applyStudioRotation(el, { angle });
    }
  }

  // Reapply DOM-backed motion timeline after seek
  applyStudioMotionFromDom(doc);
}
