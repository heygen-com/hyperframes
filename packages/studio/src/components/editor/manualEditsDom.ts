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

function isStudioManualEditGestureActive(element: HTMLElement): boolean {
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
// writes `translate`, both properties compose additively, doubling the visual offset.
//
// This helper subtracts only the baked studio offset from m41/m42, preserving any GSAP animation
// contribution (e.g. a tween animating y: -20). The studio offset is read from the CSS custom
// properties which tell us exactly how much was baked from the CSS translate.
function isIdentityAfterTranslateStrip(m: DOMMatrix): boolean {
  return m.is2D && m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1;
}

function stripGsapTranslateFromTransform(element: HTMLElement): void {
  if (element.hasAttribute(STUDIO_MANUAL_EDIT_GESTURE_ATTR)) return;
  const transform = element.style.getPropertyValue("transform");
  if (!transform || transform === "none") return;
  const DOMMatrixCtor = (element.ownerDocument.defaultView as (Window & typeof globalThis) | null)
    ?.DOMMatrix;
  if (!DOMMatrixCtor) return;
  try {
    const m = new DOMMatrixCtor(transform);
    if (m.m41 === 0 && m.m42 === 0) return;
    const offsetX = readPxCustomProperty(element, STUDIO_OFFSET_X_PROP);
    const offsetY = readPxCustomProperty(element, STUDIO_OFFSET_Y_PROP);
    const angle = Math.atan2(m.b, m.a);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    m.m41 -= offsetX * cos - offsetY * sin;
    m.m42 -= offsetX * sin + offsetY * cos;
    if (Math.abs(m.m41) < 0.01 && Math.abs(m.m42) < 0.01 && isIdentityAfterTranslateStrip(m)) {
      element.style.removeProperty("transform");
    } else {
      element.style.setProperty("transform", m.toString());
    }
  } catch {
    /* non-parseable transform — leave as-is */
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

  const isGsapAnimated = gsapAnimatesProperty(element, "x", "y");
  if (isGsapAnimated) {
    // For GSAP-animated elements: use gsap.set for positioning (the timeline
    // is paused during drag). Set translate:none explicitly to prevent
    // double-counting with the transform.
    element.style.setProperty("translate", "none");
    const win = element.ownerDocument.defaultView as
      | (Window & { gsap?: { set: (el: Element, vars: Record<string, unknown>) => void } })
      | null;
    win?.gsap?.set(element, { x: offset.x, y: offset.y });
  } else {
    // Non-GSAP elements: use CSS translate as before.
    element.style.setProperty(
      "translate",
      composeTranslateValue(element, `${Math.round(offset.x)}px`, `${Math.round(offset.y)}px`),
    );
    stripGsapTranslateFromTransform(element);
  }
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

/* ── HTML patch builders (re-exported from manualEditsDomPatches) ── */
export {
  buildPathOffsetPatches,
  buildClearPathOffsetPatches,
  buildBoxSizePatches,
  buildClearBoxSizePatches,
  buildRotationPatches,
  buildClearRotationPatches,
  buildMotionPatches,
  buildClearMotionPatches,
} from "./manualEditsDomPatches";

/* ── Seek reapply (position + motion) ────────────────────────────── */

function queryStudioElements(doc: Document, attr: string): HTMLElement[] {
  const ctor = doc.defaultView?.HTMLElement;
  if (!ctor) return [];
  const elements = Array.from(doc.querySelectorAll(`[${attr}="true"]`)).filter(
    (el): el is HTMLElement => el instanceof ctor,
  );
  // Handle legacy HTML files where attributes were persisted with a double data- prefix
  const legacyAttr = `data-${attr}`;
  for (const el of doc.querySelectorAll(`[${legacyAttr}="true"]`)) {
    if (el instanceof ctor && !el.hasAttribute(attr)) {
      el.setAttribute(attr, "true");
      el.removeAttribute(legacyAttr);
      elements.push(el);
    }
  }
  return elements;
}

function reapplyPathOffsets(doc: Document): void {
  for (const el of queryStudioElements(doc, STUDIO_PATH_OFFSET_ATTR)) {
    // Skip elements where GSAP actively animates position — GSAP bakes the
    // CSS translate into its transform and sets translate: none every tick.
    // Stripping/restoring would oscillate against GSAP's rendering.
    if (gsapAnimatesProperty(el, "x", "y")) continue;
    const x = el.style.getPropertyValue(STUDIO_OFFSET_X_PROP);
    const y = el.style.getPropertyValue(STUDIO_OFFSET_Y_PROP);
    if (x || y) {
      applyStudioPathOffset(el, {
        x: Number.parseFloat(x) || 0,
        y: Number.parseFloat(y) || 0,
      });
    }
  }
}

function gsapAnimatesProperty(el: HTMLElement, ...props: string[]): boolean {
  const win = el.ownerDocument.defaultView as
    | (Window & {
        __timelines?: Record<
          string,
          {
            getChildren?: (
              deep: boolean,
            ) => Array<{ targets?: () => Element[]; vars?: Record<string, unknown> }>;
          }
        >;
      })
    | null;
  if (!win?.__timelines) return false;
  const propSet = new Set(props);
  for (const tl of Object.values(win.__timelines)) {
    if (!tl?.getChildren) continue;
    try {
      for (const child of tl.getChildren(true)) {
        if (!child.targets || !child.vars) continue;
        let targetsEl = false;
        for (const t of child.targets()) {
          if (t === el || (el.id && t.id === el.id)) {
            targetsEl = true;
            break;
          }
        }
        if (!targetsEl) continue;
        const vars = child.vars;
        for (const p of propSet) {
          if (p in vars) return true;
        }
        if (vars.keyframes && typeof vars.keyframes === "object") {
          for (const kfVal of Object.values(vars.keyframes as Record<string, unknown>)) {
            if (kfVal && typeof kfVal === "object") {
              for (const p of propSet) {
                if (p in (kfVal as Record<string, unknown>)) return true;
              }
            }
          }
        }
      }
    } catch {
      /* */
    }
  }
  return false;
}

function reapplyBoxSizes(doc: Document): void {
  for (const el of queryStudioElements(doc, STUDIO_BOX_SIZE_ATTR)) {
    if (gsapAnimatesProperty(el, "width", "height")) continue;
    const w = Number.parseFloat(el.style.getPropertyValue(STUDIO_WIDTH_PROP));
    const h = Number.parseFloat(el.style.getPropertyValue(STUDIO_HEIGHT_PROP));
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      applyStudioBoxSize(el, { width: w, height: h });
    }
  }
}

function reapplyRotations(doc: Document): void {
  for (const el of queryStudioElements(doc, STUDIO_ROTATION_ATTR)) {
    const angle = Number.parseFloat(el.style.getPropertyValue(STUDIO_ROTATION_PROP));
    if (Number.isFinite(angle)) {
      applyStudioRotation(el, { angle });
    }
  }
}

export function reapplyPositionEditsAfterSeek(doc: Document): void {
  reapplyPathOffsets(doc);
  reapplyBoxSizes(doc);
  reapplyRotations(doc);
  applyStudioMotionFromDom(doc);
}
