// Capture-first preview key handler: runs armed Delete/nudge in-frame and forwards Studio shortcuts.
import { matchCombo, parseCombo, type Combo } from "../../keyCombo";
import { capturePageIn, markedForStudio } from "../../studioPreviewMark";
import { swallow } from "../diagnostics";
import { isDomNode, isElementNode, isStylableElement } from "../domRealm";
import { postOnPort } from "../runtimePort";
import { drawDrafts } from "../editingDraft";
import {
  EDITING_ELEMENT_HANDLE,
  MAX_DESCRIBE_HANDLES,
  type EditingElementHandle,
} from "../editingElement";
import { gsapPosition } from "../editingGestureStart";
import { elementForHandle } from "../editingHandles";
import { isRemovableNode, outermostElements } from "./removeElements";
import { isActiveTextEditTarget } from "./textEdit";

export const MAX_CANVAS_KEY_COMBOS = 96;
const MAX_COMBO_LENGTH = 64;
const MAX_STEP_PX = 1_000;
const SHIELD_EVENTS = ["keydown", "keyup", "keypress", "beforeinput", "input"] as const;

export interface CanvasKeyNudgeCombo {
  combo: string;
  dx: number;
  dy: number;
}

export interface ArmCanvasKeysParams {
  revision: number;
  focus?: boolean;
  deleteHandles: EditingElementHandle[];
  deleteCombos: string[];
  nudge: {
    handles: EditingElementHandle[];
    combos: CanvasKeyNudgeCombo[];
  } | null;
  forwardCombos: string[];
}

export interface ArmCanvasKeysResult {
  armed: boolean;
  revision: number;
}

export interface ResolveCanvasKeyActionParams {
  actionId: number;
  outcome: "commit" | "rollback";
}

export interface ResolveCanvasKeyActionResult {
  resolved: boolean;
  restored: number;
}

export type CanvasKeyActionEvent =
  | {
      action: "delete";
      actionId: number;
      revision: number;
      handles: EditingElementHandle[];
    }
  | {
      action: "nudge";
      actionId: number;
      revision: number;
      handles: EditingElementHandle[];
      dx: number;
      dy: number;
      totalDx: number;
      totalDy: number;
      drafts: Record<string, number>;
      /** GSAP x/y of each GSAP-owned handle before the burst's first draw. */
      baseGsap: Record<string, { x: number; y: number }>;
    };

type Fields = Record<string, unknown>;
const isRecord = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;
const isHandle = (value: unknown): value is EditingElementHandle =>
  typeof value === "string" && EDITING_ELEMENT_HANDLE.test(value);
const isNonNegInt = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isValidComboText = (value: unknown): value is string =>
  typeof value === "string" && value.length <= MAX_COMBO_LENGTH && parseCombo(value) !== null;

function parseHandles(value: unknown, max = MAX_DESCRIBE_HANDLES): EditingElementHandle[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  return value.every(isHandle) ? value : null;
}

function parseCombos(value: unknown, max = MAX_CANVAS_KEY_COMBOS): string[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  return value.every(isValidComboText) ? value : null;
}

function isStep(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_STEP_PX;
}

function parseNudgeCombo(value: unknown): CanvasKeyNudgeCombo | null {
  if (!isRecord(value) || Object.keys(value).sort().join() !== "combo,dx,dy") return null;
  if (!isValidComboText(value.combo) || !isStep(value.dx) || !isStep(value.dy)) return null;
  return { combo: value.combo, dx: value.dx, dy: value.dy };
}

function parseNudge(value: unknown): ArmCanvasKeysParams["nudge"] | undefined {
  if (value === null) return null;
  if (!isRecord(value) || Object.keys(value).sort().join() !== "combos,handles") return undefined;
  const handles = parseHandles(value.handles);
  if (!handles || !handles.length || !Array.isArray(value.combos) || value.combos.length > 32)
    return undefined;
  const combos = value.combos.map(parseNudgeCombo);
  return combos.includes(null) ? undefined : { handles, combos: combos as CanvasKeyNudgeCombo[] };
}

export function parseArmCanvasKeys(params: unknown): ArmCanvasKeysParams | null {
  if (!isRecord(params) || !isNonNegInt(params.revision)) return null;
  const keys = Object.keys(params).sort().join();
  const validKeys =
    keys === "deleteCombos,deleteHandles,forwardCombos,nudge,revision" ||
    keys === "deleteCombos,deleteHandles,focus,forwardCombos,nudge,revision";
  if (!validKeys) return null;
  if ("focus" in params && typeof params.focus !== "boolean") return null;
  const deleteHandles = parseHandles(params.deleteHandles);
  const deleteCombos = parseCombos(params.deleteCombos, 16);
  const forwardCombos = parseCombos(params.forwardCombos);
  const nudge = parseNudge(params.nudge);
  if (!deleteHandles || !deleteCombos || !forwardCombos || nudge === undefined) return null;
  return {
    revision: params.revision,
    ...("focus" in params ? { focus: params.focus as boolean } : {}),
    deleteHandles,
    deleteCombos,
    nudge,
    forwardCombos,
  };
}

export function parseResolveCanvasKeyAction(params: unknown): ResolveCanvasKeyActionParams | null {
  if (!isRecord(params) || Object.keys(params).sort().join() !== "actionId,outcome") return null;
  if (!isNonNegInt(params.actionId)) return null;
  if (params.outcome !== "commit" && params.outcome !== "rollback") return null;
  return { actionId: params.actionId, outcome: params.outcome };
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function isBaseGsapMap(value: unknown): value is Record<string, { x: number; y: number }> {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(
    ([k, v]) =>
      isHandle(k) &&
      isRecord(v) &&
      Object.keys(v).sort().join() === "x,y" &&
      isFiniteNumber(v.x) &&
      isFiniteNumber(v.y),
  );
}

function isDraftMap(value: unknown): value is Record<string, number> {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(
    ([k, v]) => isHandle(k) && typeof v === "number" && Number.isSafeInteger(v) && v >= 0,
  );
}

export function canvasKeyActionEvent(data: unknown, version: number): CanvasKeyActionEvent | null {
  if (!isRecord(data) || data.v !== version || data.event !== "canvas-key-action") return null;
  if (!isNonNegInt(data.actionId) || !isNonNegInt(data.revision)) return null;
  const handles = parseHandles(data.handles);
  if (!handles || !handles.length) return null;
  if (data.action === "delete") {
    if (Object.keys(data).sort().join() !== "action,actionId,event,handles,revision,v") return null;
    return { action: "delete", actionId: data.actionId, revision: data.revision, handles };
  }
  if (data.action === "nudge") {
    const keys = Object.keys(data).sort().join();
    if (keys !== "action,actionId,baseGsap,drafts,dx,dy,event,handles,revision,totalDx,totalDy,v")
      return null;
    if (
      !isStep(data.dx) ||
      !isStep(data.dy) ||
      !isFiniteNumber(data.totalDx) ||
      !isFiniteNumber(data.totalDy) ||
      !isDraftMap(data.drafts) ||
      !isBaseGsapMap(data.baseGsap)
    )
      return null;
    return {
      action: "nudge",
      actionId: data.actionId,
      revision: data.revision,
      handles,
      dx: data.dx,
      dy: data.dy,
      totalDx: data.totalDx,
      totalDy: data.totalDy,
      drafts: data.drafts,
      baseGsap: data.baseGsap,
    };
  }
  return null;
}

// Native references captured at script evaluation time before any composition script runs.
const nativeStopImmediatePropagation =
  typeof Event !== "undefined" ? Event.prototype.stopImmediatePropagation : null;
const nativePreventDefault = typeof Event !== "undefined" ? Event.prototype.preventDefault : null;
const nativeIsTrustedGetter =
  typeof Event !== "undefined"
    ? Object.getOwnPropertyDescriptor(Event.prototype, "isTrusted")?.get
    : undefined;
function stopEvent(event: Event): void {
  if (nativeStopImmediatePropagation) nativeStopImmediatePropagation.call(event);
  else event.stopImmediatePropagation();
}

function preventEvent(event: Event): void {
  if (nativePreventDefault) nativePreventDefault.call(event);
  else event.preventDefault();
}

function isTrustedEvent(event: Event): boolean {
  if (nativeIsTrustedGetter) {
    try {
      return nativeIsTrustedGetter.call(event) === true;
    } catch {
      // Test realms may define isTrusted directly on the event instance.
    }
  }
  return event.isTrusted === true;
}

interface NudgeTargetBase {
  handle: EditingElementHandle;
  gsap: { x: number; y: number; cos: number; sin: number } | null;
}

interface ArmedNudge {
  handles: EditingElementHandle[];
  combos: Array<{ combo: Combo; dx: number; dy: number }>;
  totalDx: number;
  totalDy: number;
  bases: NudgeTargetBase[] | null;
}

interface ArmedState {
  port: MessagePort;
  version: number;
  revision: number;
  deleteHandles: EditingElementHandle[];
  deleteCombos: Combo[];
  nudge: ArmedNudge | null;
  forwardCombos: Combo[];
  down: Set<string>;
}

interface DetachedNode {
  element: Element;
  parent: ParentNode | null;
  previousSibling: ChildNode | null;
  nextSibling: ChildNode | null;
  index: number;
}

let armed: ArmedState | null = null;
let lastActionId = 0;
const pendingDeletes = new Map<number, DetachedNode[]>();
let shieldDispose: (() => void) | null = null;
let shieldWindow: Window | null = null;
const frameKeydownListeners = new Set<(event: KeyboardEvent) => void>();

export function listenFrameKeydown(
  view: Window,
  listener: (event: KeyboardEvent) => void,
): () => void {
  if (view !== shieldWindow) {
    view.addEventListener("keydown", listener, true);
    return () => view.removeEventListener("keydown", listener, true);
  }
  frameKeydownListeners.add(listener);
  return () => frameKeydownListeners.delete(listener);
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function resolveNudgeBases(handles: readonly EditingElementHandle[]): NudgeTargetBase[] {
  return handles.map((handle) => {
    const el = elementForHandle(handle);
    const owned = el ? gsapPosition(el) : null;
    if (!owned || !el || !isStylableElement(el)) return { handle, gsap: null };
    const rotDeg = Number.parseFloat(el.style.getPropertyValue("--hf-studio-rotation")) || 0;
    const rad = (-rotDeg * Math.PI) / 180;
    return {
      handle,
      gsap: { x: owned.x, y: owned.y, cos: Math.cos(rad), sin: Math.sin(rad) },
    };
  });
}

function runLocalDelete(state: ArmedState): void {
  const pairs: Array<{ handle: EditingElementHandle; element: Element }> = [];
  for (const handle of state.deleteHandles) {
    const element = elementForHandle(handle);
    if (isRemovableNode(element) && element.isConnected) pairs.push({ handle, element });
  }
  const kept = new Set(outermostElements(pairs.map((p) => p.element)));
  const targets = pairs.filter((p) => kept.has(p.element));
  state.deleteHandles = [];
  state.nudge = null;
  if (!targets.length) return;
  const detached: DetachedNode[] = [];
  for (const { element } of targets) {
    const parent = element.parentNode;
    const index = parent ? Array.prototype.indexOf.call(parent.childNodes, element) : -1;
    detached.push({
      element,
      parent,
      previousSibling: element.previousSibling,
      nextSibling: element.nextSibling,
      index,
    });
    element.remove();
  }
  const actionId = ++lastActionId;
  pendingDeletes.set(actionId, detached);
  postOnPort(state.port, {
    v: state.version,
    event: "canvas-key-action",
    action: "delete",
    actionId,
    revision: state.revision,
    handles: targets.map((t) => t.handle),
  });
}

function runLocalNudge(state: ArmedState, nudge: ArmedNudge, dx: number, dy: number): void {
  nudge.totalDx += dx;
  nudge.totalDy += dy;
  nudge.bases ??= resolveNudgeBases(nudge.handles);
  const drafts = nudge.bases.map((base) => {
    if (!base.gsap) {
      return {
        handle: base.handle,
        translate: { x: round3(nudge.totalDx), y: round3(nudge.totalDy) },
        size: null,
      };
    }
    const adjX = nudge.totalDx * base.gsap.cos - nudge.totalDy * base.gsap.sin;
    const adjY = nudge.totalDx * base.gsap.sin + nudge.totalDy * base.gsap.cos;
    return {
      handle: base.handle,
      translate: {
        x: round3(base.gsap.x + adjX),
        y: round3(base.gsap.y + adjY),
        route: "gsap" as const,
      },
      size: null,
    };
  });
  const reply = drawDrafts(drafts);
  const baseGsap: Record<string, { x: number; y: number }> = {};
  for (const { handle, gsap } of nudge.bases) if (gsap) baseGsap[handle] = { x: gsap.x, y: gsap.y };
  const actionId = ++lastActionId;
  postOnPort(state.port, {
    v: state.version,
    event: "canvas-key-action",
    action: "nudge",
    actionId,
    revision: state.revision,
    handles: nudge.handles,
    dx,
    dy,
    totalDx: nudge.totalDx,
    totalDy: nudge.totalDy,
    drafts: reply.drafts,
    baseGsap,
  });
}

function forwardTrustedKey(state: ArmedState, event: KeyboardEvent): void {
  postOnPort(state.port, {
    v: state.version,
    event: "key",
    key: {
      type: event.type === "keyup" ? "keyup" : "keydown",
      key: event.key,
      code: event.code,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      repeat: event.repeat,
    },
  });
}

function handleTrustedKeyDown(state: ArmedState, event: KeyboardEvent): void {
  if (
    !event.repeat &&
    state.deleteHandles.length > 0 &&
    state.deleteCombos.some((combo) => matchCombo(event, combo))
  ) {
    preventEvent(event);
    runLocalDelete(state);
    return;
  }
  const nudgeHit = state.nudge?.combos.find(({ combo }) => matchCombo(event, combo));
  if (state.nudge && nudgeHit) {
    preventEvent(event);
    runLocalNudge(state, state.nudge, nudgeHit.dx, nudgeHit.dy);
    return;
  }
  if (state.forwardCombos.some((combo) => matchCombo(event, combo))) preventEvent(event);
  state.down.add(event.code || event.key);
  forwardTrustedKey(state, event);
}

function isFilmEditableTarget(target: EventTarget | null): boolean {
  if (!isElementNode(target)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return (target as HTMLElement).isContentEditable === true;
}

function handleShieldKey(state: ArmedState, event: KeyboardEvent): void {
  if (event.type === "keydown") {
    if (isFilmEditableTarget(event.target)) preventEvent(event);
    handleTrustedKeyDown(state, event);
    return;
  }
  if (state.down.delete(event.code || event.key)) forwardTrustedKey(state, event);
}

function hear(listener: (event: KeyboardEvent) => void, event: Event): void {
  try {
    listener(event as KeyboardEvent);
  } catch (err) {
    swallow("canvasKeys.frameKeydown", err);
  }
}

function onShieldEvent(event: Event): void {
  if (event.type === "keydown") for (const listener of frameKeydownListeners) hear(listener, event);
  const state = armed;
  if (!state || !isTrustedEvent(event) || isActiveTextEditTarget(event.target)) return;
  stopEvent(event);
  if (event.type !== "keydown" && event.type !== "keyup") return preventEvent(event);
  handleShieldKey(state, event as KeyboardEvent);
}

function isExportRenderEnvironment(): boolean {
  return Boolean(
    (window as { __HF_EXPORT_RENDER_SEEK_CONFIG?: unknown }).__HF_EXPORT_RENDER_SEEK_CONFIG,
  );
}

/**
 * Installs capture-first window key listeners in opaque-origin Studio preview frames only (never
 * in same-origin previews, renders, captures, exports, or third-party pages). Idempotent.
 */
export function installPreviewKeyShield(
  targetWindow: Window = window,
  parentWindow: Window = targetWindow.parent,
): () => void {
  if (shieldDispose) return shieldDispose;
  if (
    parentWindow === targetWindow ||
    targetWindow.origin !== "null" ||
    !markedForStudio(targetWindow.document) ||
    capturePageIn(targetWindow.document) ||
    isExportRenderEnvironment()
  ) {
    return () => {};
  }
  for (const type of SHIELD_EVENTS) {
    targetWindow.addEventListener(type, onShieldEvent, { capture: true });
  }
  shieldWindow = targetWindow;
  shieldDispose = () => {
    for (const type of SHIELD_EVENTS) {
      targetWindow.removeEventListener(type, onShieldEvent, { capture: true });
    }
    shieldDispose = null;
    shieldWindow = null;
  };
  return shieldDispose;
}

function ensureBodyFocusable(): HTMLBodyElement | null {
  const body = document.body as HTMLBodyElement | null;
  if (!body) return null;
  if (!body.hasAttribute("tabindex")) body.setAttribute("tabindex", "-1");
  if (!body.style.outline) body.style.outline = "none";
  return body;
}

function focusFrameSurface(): void {
  const body = ensureBodyFocusable();
  if (!body || isActiveTextEditTarget(document.activeElement)) return;
  body.focus({ preventScroll: true });
  window.focus();
}

export function armCanvasKeys(
  port: MessagePort,
  params: ArmCanvasKeysParams,
  version: number,
): ArmCanvasKeysResult {
  const hasActions =
    params.deleteHandles.length > 0 || params.nudge !== null || params.forwardCombos.length > 0;
  if (!hasActions || !shieldDispose) {
    if (armed?.port === port) armed = null;
    return { armed: false, revision: params.revision };
  }
  ensureBodyFocusable();
  const down = armed?.port === port ? armed.down : new Set<string>();
  armed = {
    port,
    version,
    revision: params.revision,
    deleteHandles: [...params.deleteHandles],
    deleteCombos: params.deleteCombos.map((text) => parseCombo(text)!),
    nudge: params.nudge
      ? {
          handles: [...params.nudge.handles],
          combos: params.nudge.combos.map((entry) => ({
            combo: parseCombo(entry.combo)!,
            dx: entry.dx,
            dy: entry.dy,
          })),
          totalDx: 0,
          totalDy: 0,
          bases: null,
        }
      : null,
    forwardCombos: params.forwardCombos.map((text) => parseCombo(text)!),
    down,
  };
  if (params.focus) focusFrameSurface();
  return { armed: true, revision: params.revision };
}

function restoreAnchorFor(
  parent: ParentNode,
  previousSibling: ChildNode | null,
  nextSibling: ChildNode | null,
  index: number,
): ChildNode | null {
  if (nextSibling && nextSibling.parentNode === parent) return nextSibling;
  if (previousSibling && previousSibling.parentNode === parent) return previousSibling.nextSibling;
  return index >= 0 ? (parent.childNodes[Math.min(index, parent.childNodes.length)] ?? null) : null;
}

function restoreDetachedNode({
  element,
  parent,
  previousSibling,
  nextSibling,
  index,
}: DetachedNode): boolean {
  if (!parent || element.isConnected) return false;
  if (isDomNode(parent) && !parent.isConnected) return false;
  parent.insertBefore(element, restoreAnchorFor(parent, previousSibling, nextSibling, index));
  return true;
}

export function resolveCanvasKeyAction({
  actionId,
  outcome,
}: ResolveCanvasKeyActionParams): ResolveCanvasKeyActionResult {
  const detached = pendingDeletes.get(actionId);
  if (!detached) return { resolved: false, restored: 0 };
  pendingDeletes.delete(actionId);
  if (outcome === "commit") return { resolved: true, restored: 0 };
  let restored = 0;
  for (let i = detached.length - 1; i >= 0; i--) {
    if (restoreDetachedNode(detached[i]!)) restored += 1;
  }
  return { resolved: true, restored };
}

export function resetCanvasKeys(disposeShield = false): void {
  armed = null;
  pendingDeletes.clear();
  if (disposeShield) shieldDispose?.();
}
