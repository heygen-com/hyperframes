/**
 * The editing channel between a preview frame and its parent: a MessagePort the
 * runtime hands the parent once, carrying typed requests and replies. The
 * runtime side is `editingAgent.ts`; `createEditingPortClient` is the parent
 * side. Both import their wire types from here, so they cannot drift apart.
 *
 * Playback transport (play, pause, seek, rate, mute, play range) stays on the
 * control protocol in `bridge.ts`. This channel carries the reads a parent
 * otherwise takes straight off the frame's window, which an opaque-origin
 * preview does not allow.
 */
import type { RestoreAttributesParams } from "./editing/restoreAttributes";
import {
  geometryEvent,
  parseWatchGeometry,
  type EditingGeometryEvent,
  type WatchGeometryParams,
} from "./editing/watchGeometry";
import {
  EDITING_ELEMENT_HANDLE,
  MAX_DESCRIBE_HANDLES,
  MAX_DRAFT_PX,
  type EditingElementDescription,
  type EditingElementHandle,
  type EditingElementHit,
  type EditingElementMatch,
} from "./editingElement";
import type { EditingElementBox, EditingElementGeometry } from "./editingGeometry";
import type { EditingGestureBase, EditingGestureStart } from "./editingGestureStart";
import type { GsapSnapshot } from "./editing/gsapSnapshot";
import type { MotionPathFrameHome } from "./editing/motionPathHome";
import type { EditingLayer, EditingStackingSibling } from "./editingLayers";
import { parseGsapSet, type GsapSetParams } from "./editing/gsapSet";
import { parsePatchTweensRequest, type PatchTweensParams } from "./editing/patchTween";
import { parseDraftEnd, type EditingDraftEnd, type EditingDraftReply } from "./editingDraftEnd";
import { parseDragChrome, type EditingDragChrome } from "./editing/dragChrome";
import {
  parseRestoreAttributesRerun,
  parseSoftReload,
  type SoftReloadParams,
  type SoftReloadResult,
} from "./editing/softReload";
import {
  parseHoldScenes,
  parseMarkScenesStale,
  parseSwapScenes,
  type HoldScenesParams,
  type MarkScenesStaleParams,
  type SwapScenesParams,
  type SwapScenesResult,
} from "./editing/scenes";
import {
  parseLiveRetime,
  type LiveRetimeParams,
  type LiveRetimeResult,
} from "./editing/liveRetime";
import type { RuntimeTimelineMessage } from "./types";
import { wallClearTimeout, wallSetTimeout } from "./wallClock";
import { parseCombo } from "../keyCombo";
import {
  captionWordsParams,
  type CaptionWordBox,
  type CaptionWordsParams,
} from "./editing/captionWords";
import {
  captionTransformParams,
  type CaptionTransformParams,
  type CaptionWordState,
} from "./editing/captionTransform";
import {
  parseColorGradingStatusParams,
  type ColorGradingStatusRequest,
} from "./editing/color-grading-status";
import {
  parseColorGradingPreviewsParams,
  type ColorGradingPreviewsRequest,
} from "./editing/color-grading-previews";
import {
  parseColorGradingPlaybackParams,
  type ColorGradingPlaybackRequest,
} from "./editing/color-grading-playback";
import { parseAssignAudioGroup, type AssignAudioGroupParams } from "./editing/assignAudioGroup";
import { parseAudioMeter, type AudioMeterLevels } from "./editing/audioMeter";
import {
  parseSetAudioGroupAttribute,
  type SetAudioGroupAttributeParams,
} from "./editing/setAudioGroupAttribute";
import {
  parseEditElement,
  type EditElementParams,
  type EditElementResult,
} from "./editing/editElement";
import {
  parseStageMeasureParams,
  type StageMeasureParams,
  type StageMeasureResult,
} from "./editing/stageMeasure";
import {
  parseStageActParams,
  stageActReadyEvent,
  stageInputEvent,
  type StageActParams,
  type StageActReadyEvent,
  type StageActResult,
  type StageInputEvent,
} from "./editing/stageAct";
import {
  parseTextEdit,
  textEditAwayEvent,
  textEditEndedEvent,
  textEditSelectionEvent,
  type TextEditAwayEvent,
  type TextEditEndedEvent,
  type TextEditSelectionEvent,
  type TextEditParams,
  type TextEditResult,
} from "./editing/textEdit";
import {
  canvasKeyActionEvent,
  parseArmCanvasKeys,
  parseResolveCanvasKeyAction,
  type ArmCanvasKeysParams,
  type ArmCanvasKeysResult,
  type CanvasKeyActionEvent,
  type ResolveCanvasKeyActionParams,
  type ResolveCanvasKeyActionResult,
} from "./editing/canvasKeys";

export {
  buildStableSelector,
  escapeCssString,
  getPreferredClassSelector,
  isEditableTextLeaf,
  readElementSource,
  readTextLayer,
  EDITING_ELEMENT_HANDLE,
  MAX_DESCRIBE_HANDLES,
  MAX_ELEMENT_ENTRIES,
  MAX_ELEMENT_TEXT,
  MAX_ELEMENT_VALUE,
  MAX_TIMELINE_TEXT,
  MAX_POINT_STACK,
  MAX_QUERY_MATCHES,
  MAX_SOURCE_GROUPS,
  isStableSelector,
  type EditingElementDescription,
  type EditingElementHandle,
  type EditingElementHit,
  type EditingElementMatch,
  type EditingElementSource,
  type EditingRect,
  type TextLayerRead,
} from "./editingElement";
export {
  elementCornerPoints,
  isElementVisibleThroughAncestors,
  readElementTransformSnapshot,
  rotationDegreesFromMatrix,
  snapCandidates,
  MAX_GEOMETRY_CHILDREN,
  MAX_SNAP_TARGETS,
  ROTATION_GATE_EPSILON_DEG,
  type EditingCorner,
  type EditingCorners,
  type EditingElementBox,
  type EditingElementGeometry,
  type ElementTransformSnapshot,
} from "./editingGeometry";
export type { EditingGestureBase, EditingGestureStart } from "./editingGestureStart";
export { MAX_CAPTION_TRANSFORM } from "./editing/captionTransform";
export { MAX_EDIT_ENTRIES } from "./editing/editElement";
export {
  MAX_DRAG_CHROME_BYTES,
  MAX_DRAG_CHROME_NODES,
  parseDragChrome,
  type EditingDragChrome,
  type EditingDragChromeNode,
} from "./editing/dragChrome";
export { MAX_FONT_FACES } from "./editing/textStyleReads";
export {
  MAX_STAGE_CLIP_KEYS,
  MAX_STAGE_ITEMS,
  type StageMeasuredItem,
  type StageMeasureParams,
  type StageMeasureResult,
  type StageTextStart,
} from "./editing/stageMeasure";
export {
  isStageColour,
  MAX_STAGE_ACTS,
  readStageActHeld,
  readStageRect,
  STAGE_ACT_BORROWS,
  STAGE_ACT_STYLES,
  type StageActBorrow,
  type StageActDraw,
  type StageActElementHold,
  type StageActGhostHold,
  type StageActHeld,
  type StageActHold,
  type StageActParams,
  type StageActReadyEvent,
  type StageActRect,
  type StageActResult,
  type StageActStyle,
  type StageActTarget,
  type StageInputEvent,
} from "./editing/stageAct";
export { MAX_STAGE_GHOST_MARKUP, type StageActGhost } from "./editing/stageGhost";
export { rotateBy, scaleBy, translateBy } from "./editing/transformValues";
export {
  MAX_SNAPSHOT_CHANNELS,
  MAX_SNAPSHOT_FIELDS,
  MAX_SNAPSHOT_TARGETS,
  MAX_SNAPSHOT_TEXT,
  MAX_SNAPSHOT_TWEENS,
  MAX_VARS_DEPTH,
  TARGET_FIELDS,
  TIMELINE_FIELDS,
} from "./editing/gsapSnapshotLimits";
export {
  compositionPoint,
  coversComposition,
  isDomLayerElement,
  isInspectableLayerElement,
  pointerTarget,
  pointerTargets,
  resolveAllVisualDomEditTargets,
  resolveLayerSelector,
  type EditingLocalPointer,
  type EditingViewport,
} from "./editingTargets";
export {
  elementZIndex,
  hasOnlyFormattingChildren,
  NON_PAINTING_TAGS,
  isCompositionHost,
  layerKindOf,
  type EditingLayer,
  type EditingStackingSibling,
  type LayerKind,
} from "./editingLayers";

export const EDITING_PROTOCOL_VERSION = 2 as const;
/** Parent to frame, on the window: carries the runtime's port in its transfer list. */
export const EDITING_CONNECT = "editing-connect";

export const EDITING_REQUEST_KINDS = [
  "hello",
  "runtime-snapshot",
  "wait-for-seek",
  "set-loop-start",
  "computed-styles",
  "authored-styles",
  "font-faces",
  "elements-at-point",
  "pointer-targets",
  "describe",
  "ancestors",
  "query",
  "geometry",
  "layers",
  "draft",
  "gesture-start",
  "gesture-base",
  "console-errors",
  "watch-keys",
  "restore-attributes",
  "caption-words",
  "caption-transform",
  "color-grading-status",
  "color-grading-previews",
  "color-grading-playback",
  "watch-geometry",
  "audio-meter",
  "document-markup",
  "set-audio-group-attribute",
  "assign-audio-group",
  "gsap-snapshot",
  "motion-path-home",
  "max-z-index",
  "crop-lift",
  "edit-element",
  "remove-elements",
  "stacking-family",
  "gsap-set",
  "patch-tweens",
  "soft-reload",
  "hold-scenes",
  "mark-scenes-stale",
  "swap-scenes",
  "live-retime",
  "rebind-timing",
  "assets-unloaded",
  "text-edit",
  "serve-paused-frames",
  "frame-presented",
  "arm-canvas-keys",
  "resolve-canvas-key-action",
  "stage-measure",
  "stage-act",
] as const;
export type EditingRequestKind = (typeof EDITING_REQUEST_KINDS)[number];

export interface EditingRuntimeSnapshot {
  /** The runtime has installed its player API. */
  playerReady: boolean;
  /** Why the runtime failed to start, when it did. */
  startupError: string | null;
  /** The clip manifest the runtime last posted as its `timeline` message. */
  clipManifest: RuntimeTimelineMessage | null;
  /** `[childId, parentId]` for each nested clip in the runtime's clip tree. */
  clipParents: Array<[string, string]>;
}

export { MAX_DRAFT_PX };
export const EDITING_REQUEST_TIMEOUT_MS = 5_000;
export const MAX_DRAFT_DEG = 36_000;
export const MAX_WATCHED_KEYS = 32;

/** A keystroke the frame forwards for `watch-keys`, as an unasked port message with no id. */
export interface EditingKeyEvent {
  type: "keydown" | "keyup";
  key: string;
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
}
export type EditingKeyMessage = {
  v: typeof EDITING_PROTOCOL_VERSION;
  event: "key";
  key: EditingKeyEvent;
};

/** The `rotate` property's whole value in degrees, or GSAP's rotation; null takes the drawn turn back. */
export type EditingDraftRotate =
  | { angle: number; route: "css" | "gsap" }
  | { angle: number; route: "transform"; value: string };
export type { EditingDraftEnd };
export const DRAFT_GSAP_PROPS = [
  "x",
  "y",
  "opacity",
  "scale",
  "rotation",
  "rotationX",
  "rotationY",
  "z",
];
export type EditingDraftProps = { seconds: number; values: Record<string, number> };
/** A gesture's draft on one element: null puts that part back; an end keeps what is drawn or restores. */
export type EditingDraft =
  | {
      handle: EditingElementHandle;
      translate: { x: number; y: number; route?: "gsap" } | null;
      size: { width: number; height: number } | null;
      rotate?: EditingDraftRotate | null;
      props?: EditingDraftProps | null;
    }
  | EditingDraftEnd;

type NoParams = Record<string, never>;
export type FramePresentedParams = { waitMs?: number };
const MAX_FRAME_PRESENTED_WAIT_MS = 15_000;
export interface EditingRequests {
  hello: {
    params: NoParams;
    result: { version: typeof EDITING_PROTOCOL_VERSION; kinds: string[] };
  };
  "runtime-snapshot": { params: NoParams; result: EditingRuntimeSnapshot };
  /** `waited` is false when the runtime has no seek-completion hook. */
  "wait-for-seek": { params: NoParams; result: { waited: boolean } };
  /** Where a looping playback wraps to; null stops looping from a custom start. */
  "set-loop-start": { params: { seconds: number | null }; result: { applied: boolean } };
  /** The element `selector` first matches, or `handle` names. `styles` is null for none; empty values are left out. */
  "computed-styles": {
    params: (
      | { selector: string }
      | { handle: EditingElementHandle }
      | { selector: string; every: true }
    ) & { properties: string[] };
    result: {
      styles: Record<string, string> | null;
      matches?: Array<Record<string, string> | null>;
      truncated?: boolean;
    };
  };
  "authored-styles": {
    params: { handle: EditingElementHandle; properties: string[] };
    result: { styles: Record<string, string> | null };
  };
  "font-faces": {
    params: NoParams;
    result: { families: string[]; ownFaces: Array<{ family: string; src: string }> };
  };
  /** The stack under a viewport point, topmost first, up to MAX_POINT_STACK. Describe one to keep. */
  "elements-at-point": {
    params: { x: number; y: number };
    result: { elements: EditingElementHit[] };
  };
  /** The pick at fractions `x`, `y` of the root's box, and the stack a press cycles, MAX_POINT_STACK. */
  "pointer-targets": {
    params: { x: number; y: number };
    result: { target: EditingElementHit | null; stack: EditingElementHit[] };
  };
  /** One entry per handle, in order; null for an unknown or removed element. */
  describe: {
    params: { handles: EditingElementHandle[] };
    result: { elements: Array<EditingElementDescription | null> };
  };
  /** Each handle's ancestors, parent first, up to MAX_DESCRIBE_HANDLES; null as in `describe`. */
  ancestors: {
    params: { handles: EditingElementHandle[] };
    result: { ancestors: Array<EditingElementHandle[] | null> };
  };
  /** The matches of `selector` in document order, up to MAX_QUERY_MATCHES; an invalid one fails. */
  query: {
    params: { selector: string };
    result: { matches: EditingElementMatch[]; truncated: boolean };
  };
  /** Each handle's overlay geometry, null as in `describe`; `children` names whose descendant boxes to add. */
  geometry: {
    params: { handles: EditingElementHandle[]; children?: EditingElementHandle };
    result: {
      elements: Array<EditingElementGeometry | null>;
      children: EditingElementBox[] | null;
    };
  };
  /** The Layers walk from `offset`, MAX_QUERY_MATCHES at a time, scoped to a drilled-into `group`;
   * `missingGroup` says this page has no such group, and lists nothing. */
  layers: {
    params: { group?: EditingElementHandle; offset?: number };
    result: { layers: EditingLayer[]; truncated: boolean; missingGroup: boolean };
  };
  /** Gesture drafts in order, up to MAX_DESCRIBE_HANDLES, and the chrome painted with them (null clears it). */
  draft: {
    params: { drafts: EditingDraft[]; chrome?: EditingDragChrome };
    result: EditingDraftReply & { gsapSetTakesDrafts?: true };
  };
  "gesture-start": {
    params: { handles: EditingElementHandle[] };
    result: { elements: Array<EditingGestureStart | null>; snap: EditingElementBox[] };
  };
  "gesture-base": {
    params: { handles: EditingElementHandle[] };
    result: { elements: Array<EditingGestureBase | null> };
  };
  "console-errors": { params: { from: number }; result: { errors: string[]; truncated: boolean } };
  /** The frame cancels these combos outside the elements that own keys, and forwards them and their
   * keyups to this port; an empty list stops. */
  "watch-keys": { params: { combos: string[] }; result: { watching: number } };
  "restore-attributes": {
    params: RestoreAttributesParams;
    result: { applied: boolean; reran?: boolean };
  };
  /** Boxes of the words of visible caption groups; a group written as plain text is split into word spans. */
  "caption-words": { params: CaptionWordsParams; result: { boxes: CaptionWordBox[] } };
  "caption-transform": { params: CaptionTransformParams; result: { words: CaptionWordState[] } };
  "color-grading-status": ColorGradingStatusRequest;
  "color-grading-previews": ColorGradingPreviewsRequest;
  "color-grading-playback": ColorGradingPlaybackRequest;
  "watch-geometry": { params: WatchGeometryParams; result: { watching: number } };
  "audio-meter": { params: { on: boolean }; result: { levels: AudioMeterLevels | null } };
  "document-markup": { params: NoParams; result: { html: string; baseURI: string } };
  "set-audio-group-attribute": {
    params: SetAudioGroupAttributeParams;
    result: { applied: boolean };
  };
  "assign-audio-group": {
    params: AssignAudioGroupParams;
    result: { previous: Array<string | null>; changed: boolean };
  };
  "gsap-snapshot": { params: NoParams; result: GsapSnapshot };
  "motion-path-home": { params: { selector: string }; result: MotionPathFrameHome };
  "max-z-index": { params: NoParams; result: { zIndex: number } };
  "crop-lift": {
    params: { handle: EditingElementHandle; lift: boolean };
    result: { lifted: boolean; clipPath: string | null };
  };
  "edit-element": { params: EditElementParams; result: EditElementResult };
  "remove-elements": { params: { handles: EditingElementHandle[] }; result: { removed: number } };
  "stacking-family": {
    params: { handle: EditingElementHandle };
    result: { family: EditingStackingSibling[] | null; locked: boolean };
  };
  "gsap-set": { params: GsapSetParams; result: { applied: boolean } };
  "patch-tweens": { params: PatchTweensParams; result: { patched: boolean } };
  "soft-reload": { params: SoftReloadParams; result: { result: SoftReloadResult } };
  "hold-scenes": { params: HoldScenesParams; result: { held: boolean } };
  "mark-scenes-stale": { params: MarkScenesStaleParams; result: { marked: true } };
  "swap-scenes": { params: SwapScenesParams; result: SwapScenesResult };
  "live-retime": { params: LiveRetimeParams; result: { result: LiveRetimeResult } };
  "rebind-timing": { params: { time: number }; result: { rebound: boolean } };
  "assets-unloaded": { params: NoParams; result: { unloaded: boolean } };
  "text-edit": { params: TextEditParams; result: TextEditResult };
  /** Studio's paused-frame decoding port (`editing/pausedFrames.ts`); false when no runtime can use it. */
  "serve-paused-frames": { params: { channel: MessagePort }; result: { served: boolean } };
  "frame-presented": { params: FramePresentedParams; result: { presented: boolean } };
  "arm-canvas-keys": { params: ArmCanvasKeysParams; result: ArmCanvasKeysResult };
  "resolve-canvas-key-action": {
    params: ResolveCanvasKeyActionParams;
    result: ResolveCanvasKeyActionResult;
  };
  "stage-measure": { params: StageMeasureParams; result: StageMeasureResult };
  /** Holds, draws and gives back Studio's stage acts inside the frame (`editing/stageAct.ts`). */
  "stage-act": { params: StageActParams; result: StageActResult };
}
export type EditingParams<K extends EditingRequestKind> = EditingRequests[K]["params"];
export type EditingResult<K extends EditingRequestKind> = EditingRequests[K]["result"];

export type EditingErrorCode =
  | "malformed"
  | "unsupported-version"
  | "unknown-kind"
  | "invalid-params"
  | "failed"
  | "timeout"
  | "disposed";

export type EditingReply =
  | { v: typeof EDITING_PROTOCOL_VERSION; id: number; ok: true; result: unknown }
  | {
      v: typeof EDITING_PROTOCOL_VERSION;
      id: number | null;
      ok: false;
      error: { code: EditingErrorCode; message: string };
    };

export type ParsedEditingRequest =
  | { ok: true; id: number; kind: EditingRequestKind; params: EditingParams<EditingRequestKind> }
  | { ok: false; id: number | null; code: EditingErrorCode; message: string };

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

const MAX_SELECTOR_LENGTH = 2_000;
const MAX_STYLE_PROPERTIES = 64;
const MAX_STYLE_PROPERTY_LENGTH = 256;
const STYLE_PROPERTY = /^(?:[a-z][a-z0-9-]*|--[\w\u0080-\uffff-]+)$/;

const hasKeys = (params: unknown, keys: string): params is Record<string, unknown> =>
  isPlainRecord(params) && Object.keys(params).sort().join() === keys;

const noParams = (params: unknown): NoParams | null =>
  params === undefined || (isPlainRecord(params) && Object.keys(params).length === 0) ? {} : null;

function parseFramePresented(params: unknown): FramePresentedParams | null {
  if (noParams(params)) return {};
  if (!hasKeys(params, "waitMs")) return null;
  const { waitMs } = params;
  const bounded =
    typeof waitMs === "number" &&
    Number.isFinite(waitMs) &&
    waitMs > 0 &&
    waitMs <= MAX_FRAME_PRESENTED_WAIT_MS;
  return bounded ? { waitMs } : null;
}

const clientWaitPastFrameDeadline = (kind: EditingRequestKind, params: unknown): number =>
  kind === "frame-presented" && isPlainRecord(params) && typeof params.waitMs === "number"
    ? params.waitMs + 1_000
    : 0;

const isSelector = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_SELECTOR_LENGTH;
const isHandle = (value: unknown): value is EditingElementHandle =>
  typeof value === "string" && EDITING_ELEMENT_HANDLE.test(value);

function styleTarget(params: Record<string, unknown>) {
  const keys = Object.keys(params).sort().join();
  const { selector, handle, every, properties } = params;
  if (keys === "properties,selector" && isSelector(selector)) return { selector };
  if (keys === "every,properties,selector" && every === true && isSelector(selector))
    return everyMatchProperties(properties) ? { selector, every } : null;
  return keys === "handle,properties" && isHandle(handle) ? { handle } : null;
}

const EVERY_MATCH_STYLES: readonly string[] = ["display"];
const everyMatchProperties = (properties: unknown) =>
  Array.isArray(properties) && properties.every((name) => EVERY_MATCH_STYLES.includes(name));

function styleProperties(properties: unknown): string[] | null {
  if (!Array.isArray(properties) || properties.length > MAX_STYLE_PROPERTIES) return null;
  const names = properties.filter(
    (name): name is string =>
      typeof name === "string" &&
      name.length <= MAX_STYLE_PROPERTY_LENGTH &&
      STYLE_PROPERTY.test(name),
  );
  return names.length === properties.length ? names : null;
}

function handleList(params: unknown): { handles: EditingElementHandle[] } | null {
  if (!hasKeys(params, "handles") || !Array.isArray(params.handles)) return null;
  const { handles } = params;
  if (!handles.length || handles.length > MAX_DESCRIBE_HANDLES) return null;
  return handles.every(isHandle) ? { handles } : null;
}

function point(params: unknown): { x: number; y: number } | null {
  if (!hasKeys(params, "x,y")) return null;
  const { x, y } = params;
  return Number.isFinite(x) && Number.isFinite(y) ? { x: x as number, y: y as number } : null;
}

const isOffset = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

function layerParams(params: unknown): EditingParams<"layers"> | null {
  if (!isPlainRecord(params)) return null;
  const { group, offset, ...rest } = params;
  const valid = [
    Object.keys(rest).length === 0,
    group === undefined || isHandle(group),
    offset === undefined || isOffset(offset),
  ];
  if (valid.includes(false)) return null;
  return { ...(isHandle(group) && { group }), ...(isOffset(offset) && { offset }) };
}

const isDraftPx = (value: unknown, min: number): value is number =>
  Number.isFinite(value) && (value as number) >= min && Math.abs(value as number) <= MAX_DRAFT_PX;

function draftPart(value: unknown, keys: string, min: number): boolean {
  if (value === null) return true;
  if (!hasKeys(value, keys)) return false;
  return keys.split(",").every((key) => isDraftPx(value[key], min));
}

const TRANSFORM_CALL =
  /^(?:(?:translate|scale|rotate)(?:[XYZ]|3d)?|skew[XY]?|matrix(?:3d)?|perspective|calc|var|min|max|clamp)$/;

const INNER_CALL = /([\w-]+)\(([\w\s.,%+\-*/]*)\)/g;

// Innermost known calls fold to a token until none is left: an unclosed paren or a comment never folds.
export function isTransformList(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 512 || value.includes("/*")) return false;
  let rest = value;
  for (let last = ""; rest !== last; ) {
    last = rest;
    rest = rest.replace(INNER_CALL, (call, name: string) =>
      TRANSFORM_CALL.test(name) ? "0" : call,
    );
  }
  return /^[\s0]*$/.test(rest);
}

const isRotateRoute = (value: unknown): value is Record<string, unknown> =>
  (hasKeys(value, "angle,route") && (value.route === "css" || value.route === "gsap")) ||
  (hasKeys(value, "angle,route,value") &&
    value.route === "transform" &&
    isTransformList(value.value));

function draftTranslate(value: unknown): boolean {
  if (!hasKeys(value, "route,x,y")) return draftPart(value, "x,y", -MAX_DRAFT_PX);
  return (
    value.route === "gsap" && isDraftPx(value.x, -MAX_DRAFT_PX) && isDraftPx(value.y, -MAX_DRAFT_PX)
  );
}

function draftRotate(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (!isRotateRoute(value)) return false;
  return Number.isFinite(value.angle) && Math.abs(value.angle as number) <= MAX_DRAFT_DEG;
}

function draftEntry(value: unknown): EditingDraft | null {
  if (!isPlainRecord(value) || !isHandle(value.handle)) return null;
  if ("end" in value) return parseDraftEnd(value);
  return drawnParts(value) ? (value as EditingDraft) : null;
}

function drawnParts(value: Record<string, unknown>): boolean {
  const { handle: _handle, translate, size, rotate, props, ...rest } = value;
  if (Object.keys(rest).length || !("translate" in value) || !("size" in value)) return false;
  const parts = [
    draftTranslate(translate),
    draftPart(size, "height,width", 0),
    draftRotate(rotate),
  ];
  return !parts.includes(false) && draftPropsWithOneXYWriter(props, translate);
}

const isPropsShape = (
  value: unknown,
): value is { seconds: number; values: Record<string, unknown> } =>
  hasKeys(value, "seconds,values") &&
  isPlainRecord(value.values) &&
  Number.isFinite(value.seconds) &&
  (value.seconds as number) >= 0;

const isDraftValue = ([key, value]: [string, unknown]) =>
  DRAFT_GSAP_PROPS.includes(key) && isDraftPx(value, -MAX_DRAFT_PX);

const setsPosition = (keys: string[]) => keys.includes("x") || keys.includes("y");

function draftPropsWithOneXYWriter(value: unknown, translate: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (!isPropsShape(value)) return false;
  const entries = Object.entries(value.values);
  if (!entries.length || (translate !== null && setsPosition(entries.map(([key]) => key))))
    return false;
  return entries.every(isDraftValue);
}

function gsapSetWithDrafts(params: unknown): GsapSetParams | null {
  if (!isPlainRecord(params) || !("drafts" in params)) return parseGsapSet(params);
  const { drafts, ...set } = params;
  const parsed = parseGsapSet(set);
  const drawn = draftsOnly({ drafts });
  return parsed && drawn ? { ...parsed, drafts: drawn.drafts } : null;
}

function draftList(params: unknown): EditingParams<"draft"> | null {
  if (!isPlainRecord(params) || !("chrome" in params)) return draftsOnly(params);
  const { chrome, ...rest } = params;
  const drawn = draftsOnly(rest, true);
  const parsed = parseDragChrome(chrome);
  return drawn && parsed !== undefined ? { ...drawn, chrome: parsed } : null;
}

function draftsOnly(params: unknown, chromeOnly = false): { drafts: EditingDraft[] } | null {
  if (!hasKeys(params, "drafts") || !Array.isArray(params.drafts)) return null;
  const { drafts } = params;
  if ((!drafts.length && !chromeOnly) || drafts.length > MAX_DESCRIBE_HANDLES) return null;
  const parsed = drafts.map(draftEntry);
  return parsed.includes(null) ? null : { drafts: parsed as EditingDraft[] };
}

const MAX_COMBO_LENGTH = 64;

function comboList(params: unknown): EditingParams<"watch-keys"> | null {
  if (!hasKeys(params, "combos") || !Array.isArray(params.combos)) return null;
  const { combos } = params;
  if (combos.length > MAX_WATCHED_KEYS) return null;
  const valid = combos.every(
    (combo) => typeof combo === "string" && combo.length <= MAX_COMBO_LENGTH && parseCombo(combo),
  );
  return valid ? { combos } : null;
}

const KEY_EVENT_FIELDS = "altKey,code,ctrlKey,key,metaKey,repeat,shiftKey,type";
const KEY_FLAGS = ["altKey", "ctrlKey", "metaKey", "shiftKey", "repeat"] as const;

function keyEvent(value: unknown): EditingKeyEvent | null {
  if (!hasKeys(value, KEY_EVENT_FIELDS)) return null;
  const { type, key, code } = value;
  if (type !== "keydown" && type !== "keyup") return null;
  const short = (text: unknown) => typeof text === "string" && text.length <= MAX_COMBO_LENGTH;
  if (!short(key) || !short(code)) return null;
  return KEY_FLAGS.every((flag) => typeof value[flag] === "boolean")
    ? (value as unknown as EditingKeyEvent)
    : null;
}

const PARAM_PARSERS: {
  [K in EditingRequestKind]: (params: unknown) => EditingParams<K> | null;
} = {
  hello: noParams,
  "runtime-snapshot": noParams,
  "wait-for-seek": noParams,
  "set-loop-start": (params) => {
    if (!isPlainRecord(params) || Object.keys(params).join() !== "seconds") return null;
    const { seconds } = params;
    if (seconds === null) return { seconds };
    return typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0
      ? { seconds }
      : null;
  },
  "computed-styles": (params) => {
    if (!isPlainRecord(params)) return null;
    const target = styleTarget(params);
    const properties = styleProperties(params.properties);
    return target && properties ? { ...target, properties } : null;
  },
  "authored-styles": (params) => {
    if (!hasKeys(params, "handle,properties") || !isHandle(params.handle)) return null;
    const properties = styleProperties(params.properties);
    return properties?.length ? { handle: params.handle, properties } : null;
  },
  "font-faces": noParams,
  "elements-at-point": point,
  "pointer-targets": point,
  describe: handleList,
  ancestors: handleList,
  query: (params) =>
    hasKeys(params, "selector") && isSelector(params.selector)
      ? { selector: params.selector }
      : null,
  geometry: (params) => {
    if (!isPlainRecord(params)) return null;
    const { children, ...rest } = params;
    const list = handleList(rest);
    if (!list || !("children" in params)) return list;
    return isHandle(children) ? { ...list, children } : null;
  },
  layers: (params) => noParams(params) ?? layerParams(params),
  draft: draftList,
  "gesture-start": handleList,
  "gesture-base": handleList,
  "console-errors": (params) =>
    hasKeys(params, "from") && isOffset(params.from) ? { from: params.from } : null,
  "watch-keys": comboList,
  "restore-attributes": parseRestoreAttributesRerun,
  "caption-words": captionWordsParams,
  "caption-transform": captionTransformParams,
  "color-grading-status": parseColorGradingStatusParams,
  "color-grading-previews": parseColorGradingPreviewsParams,
  "color-grading-playback": parseColorGradingPlaybackParams,
  "watch-geometry": parseWatchGeometry,
  "audio-meter": parseAudioMeter,
  "document-markup": noParams,
  "set-audio-group-attribute": parseSetAudioGroupAttribute,
  "assign-audio-group": parseAssignAudioGroup,
  "gsap-snapshot": noParams,
  "motion-path-home": (params) =>
    hasKeys(params, "selector") && isSelector(params.selector)
      ? { selector: params.selector }
      : null,
  "max-z-index": noParams,
  "crop-lift": (params) =>
    hasKeys(params, "handle,lift") && isHandle(params.handle) && typeof params.lift === "boolean"
      ? { handle: params.handle, lift: params.lift }
      : null,
  "edit-element": parseEditElement,
  "remove-elements": handleList,
  "stacking-family": (params) =>
    hasKeys(params, "handle") && isHandle(params.handle) ? { handle: params.handle } : null,
  "gsap-set": gsapSetWithDrafts,
  "patch-tweens": parsePatchTweensRequest,
  "soft-reload": parseSoftReload,
  "hold-scenes": parseHoldScenes,
  "mark-scenes-stale": parseMarkScenesStale,
  "swap-scenes": parseSwapScenes,
  "live-retime": parseLiveRetime,
  "rebind-timing": (params) => {
    if (!isPlainRecord(params) || Object.keys(params).join() !== "time") return null;
    const { time } = params;
    return typeof time === "number" && Number.isFinite(time) && time >= 0 ? { time } : null;
  },
  "assets-unloaded": noParams,
  "text-edit": parseTextEdit,
  "serve-paused-frames": (params) =>
    hasKeys(params, "channel") && params.channel instanceof MessagePort
      ? { channel: params.channel }
      : null,
  "frame-presented": parseFramePresented,
  "arm-canvas-keys": parseArmCanvasKeys,
  "resolve-canvas-key-action": parseResolveCanvasKeyAction,
  "stage-measure": parseStageMeasureParams,
  "stage-act": parseStageActParams,
};

/** Hands a push to its listeners when `parse` reads it as their event; false when it is not one. */
function pushRoute<E>(
  listeners: Set<(event: E) => void>,
  parse: (data: Record<string, unknown>) => E | null | false | undefined,
): (data: Record<string, unknown>) => boolean {
  return (data) => {
    const event = parse(data);
    if (!event) return false;
    listeners.forEach((listener) => listener(event));
    return true;
  };
}

/** Validates one request off the wire. Never throws: anything unusable becomes a typed error. */
export function parseEditingRequest(data: unknown): ParsedEditingRequest {
  if (!isPlainRecord(data) || !Number.isSafeInteger(data.id) || (data.id as number) < 0) {
    return { ok: false, id: null, code: "malformed", message: "request needs a numeric id" };
  }
  const id = data.id as number;
  if (data.v !== EDITING_PROTOCOL_VERSION) {
    return { ok: false, id, code: "unsupported-version", message: "unsupported version" };
  }
  const kind = EDITING_REQUEST_KINDS.find((known) => known === data.kind);
  if (!kind) return { ok: false, id, code: "unknown-kind", message: "unknown request kind" };
  const params = PARAM_PARSERS[kind](data.params);
  if (!params)
    return { ok: false, id, code: "invalid-params", message: `invalid params for ${kind}` };
  return { ok: true, id, kind, params };
}

export class EditingPortError extends Error {
  constructor(
    readonly code: EditingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EditingPortError";
  }
}

export interface EditingPortClient {
  /** Settles when the frame's runtime serves the port this client sent it. */
  readonly ready: Promise<void>;
  request<K extends EditingRequestKind>(
    kind: K,
    params: EditingParams<K>,
    options?: { timeoutMs?: number; transfer?: Transferable[] },
  ): Promise<EditingResult<K>>;
  /** Calls `listener` with each key the frame forwards for `watch-keys`; returns the unsubscribe. */
  onKey(listener: (key: EditingKeyEvent) => void): () => void;
  onGeometry(listener: (event: EditingGeometryEvent) => void): () => void;
  onTextEditEnded(listener: (event: TextEditEndedEvent) => void): () => void;
  onTextEditAway(listener: (event: TextEditAwayEvent) => void): () => void;
  onTextEditSelection(listener: (event: TextEditSelectionEvent) => void): () => void;
  onCanvasKeyAction(listener: (event: CanvasKeyActionEvent) => void): () => void;
  onStageActReady(listener: (event: StageActReadyEvent) => void): () => void;
  onStageInput(listener: (event: StageInputEvent) => void): () => void;
  /** Rejects every pending request with `disposed` and closes the port. */
  dispose(): void;
}

type Outcome = { result: unknown } | { error: EditingPortError };

/** A reply's result or typed error. Anything off-shape is `malformed`, never a throw. */
function replyOutcome(data: Record<string, unknown>): Outcome {
  if (data.v !== EDITING_PROTOCOL_VERSION) {
    return { error: new EditingPortError("unsupported-version", "reply version") };
  }
  if (data.ok === true && "result" in data) return { result: data.result };
  const error = isPlainRecord(data.error) ? data.error : null;
  if (data.ok !== false || typeof error?.code !== "string") {
    return { error: new EditingPortError("malformed", "malformed reply") };
  }
  const message = typeof error.message === "string" ? error.message : error.code;
  return { error: new EditingPortError(error.code as EditingErrorCode, message) };
}

/** True for the frame's own note that its runtime came up. */
function runtimeCameUp(event: MessageEvent<unknown>, frame: Window | null): boolean {
  const data = event.data;
  return (
    !!frame &&
    event.source === frame &&
    isPlainRecord(data) &&
    data.source === "hf-preview" &&
    data.type === "ready"
  );
}

type Pending = {
  resolve: (result: unknown) => void;
  reject: (error: EditingPortError) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * The parent's end of the editing channel for one preview frame load. Makes the channel and sends
 * the frame one end, at once and again on the runtime's `ready`; it never takes a port from the
 * frame. Replies are data from the frame, so callers validate results.
 */
export function createEditingPortClient(options: {
  iframe: HTMLIFrameElement;
  timeoutMs?: number;
  host?: Window;
}): EditingPortClient {
  const { iframe, timeoutMs = EDITING_REQUEST_TIMEOUT_MS, host = window } = options;
  const pending = new Map<number, Pending>();
  const keyListeners = new Set<(key: EditingKeyEvent) => void>();
  const geometryListeners = new Set<(event: EditingGeometryEvent) => void>();
  const textEditListeners = new Set<(event: TextEditEndedEvent) => void>();
  const awayListeners = new Set<(event: TextEditAwayEvent) => void>();
  const selectionListeners = new Set<(event: TextEditSelectionEvent) => void>();
  const canvasKeyActionListeners = new Set<(event: CanvasKeyActionEvent) => void>();
  const stageReadyListeners = new Set<(event: StageActReadyEvent) => void>();
  const stageInputListeners = new Set<(event: StageInputEvent) => void>();
  let watchedGeometry = false;
  let port: MessagePort | null = null;
  let disposed = false;
  let lastId = 0;
  let resolveReady!: () => void;
  let rejectReady!: (error: EditingPortError) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  void ready.catch(() => {});

  const settle = (id: number, outcome: Outcome) => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    wallClearTimeout(entry.timer);
    if ("error" in outcome) entry.reject(outcome.error);
    else entry.resolve(outcome.result);
  };
  const v = EDITING_PROTOCOL_VERSION;
  const pushRoutes = [
    pushRoute(keyListeners, (d) => d.v === v && d.event === "key" && keyEvent(d.key)),
    pushRoute(geometryListeners, (d) => geometryEvent(d, v)),
    pushRoute(textEditListeners, (d) => textEditEndedEvent(d, v)),
    pushRoute(awayListeners, (d) => textEditAwayEvent(d, v)),
    pushRoute(selectionListeners, (d) => textEditSelectionEvent(d, v)),
    pushRoute(canvasKeyActionListeners, (d) => canvasKeyActionEvent(d, v)),
    pushRoute(stageReadyListeners, (d) => stageActReadyEvent(d, v)),
    pushRoute(stageInputListeners, (d) => stageInputEvent(d, v)),
  ];
  const onPush = (data: Record<string, unknown>) => void pushRoutes.some((route) => route(data));
  const onReply = (event: MessageEvent<unknown>) => {
    const data = event.data;
    if (!isPlainRecord(data)) return;
    if (typeof data.id === "number") return settle(data.id, replyOutcome(data));
    onPush(data);
  };
  let offered: MessagePort | null = null;
  const connect = () => {
    if (port || disposed) return;
    offered?.close();
    const { port1, port2 } = new MessageChannel();
    offered = port1;
    port1.onmessage = (event: MessageEvent<unknown>) => {
      if (port === port1) return onReply(event);
      const data = event.data;
      if (port || port1 !== offered || !isPlainRecord(data)) return;
      if (data.v !== EDITING_PROTOCOL_VERSION || data.ok !== true) return;
      port = port1;
      host.removeEventListener("message", onWindowMessage);
      resolveReady();
    };
    try {
      iframe.contentWindow?.postMessage(
        { source: "hf-parent", type: EDITING_CONNECT, v: EDITING_PROTOCOL_VERSION },
        "*",
        [port2],
      );
      // Waits in the port until the runtime serves it; the reply is what makes this client ready.
      port1.postMessage({ v: EDITING_PROTOCOL_VERSION, id: ++lastId, kind: "hello", params: {} });
    } catch {
      // The frame is mid-navigation; its runtime's `ready` asks again.
    }
  };
  const onWindowMessage = (event: MessageEvent<unknown>) => {
    if (runtimeCameUp(event, iframe.contentWindow)) connect();
  };
  host.addEventListener("message", onWindowMessage);
  connect();

  return {
    ready,
    request(kind, params, requestOptions) {
      if (disposed) return Promise.reject(new EditingPortError("disposed", "client disposed"));
      const id = ++lastId;
      if (kind === "watch-geometry") watchedGeometry = true;
      const limit =
        requestOptions?.timeoutMs ?? Math.max(timeoutMs, clientWaitPastFrameDeadline(kind, params));
      const result = new Promise<unknown>((resolve, reject) => {
        const timer = wallSetTimeout(
          () => settle(id, { error: new EditingPortError("timeout", `${kind} timed out`) }),
          limit,
        );
        pending.set(id, { resolve, reject, timer });
      });
      const send = () => {
        if (!pending.has(id)) return;
        try {
          port?.postMessage(
            { v: EDITING_PROTOCOL_VERSION, id, kind, params },
            requestOptions?.transfer ?? [],
          );
        } catch (err) {
          settle(id, { error: new EditingPortError("failed", String(err)) });
        }
      };
      // A ready that rejects was disposed, which has already rejected this request.
      ready.then(send, () => {});
      return result as Promise<EditingResult<typeof kind>>;
    },
    onKey(listener) {
      keyListeners.add(listener);
      return () => keyListeners.delete(listener);
    },
    onGeometry(listener) {
      geometryListeners.add(listener);
      return () => geometryListeners.delete(listener);
    },
    onTextEditEnded(listener) {
      textEditListeners.add(listener);
      return () => textEditListeners.delete(listener);
    },
    onTextEditAway(listener) {
      awayListeners.add(listener);
      return () => awayListeners.delete(listener);
    },
    onTextEditSelection(listener) {
      selectionListeners.add(listener);
      return () => selectionListeners.delete(listener);
    },
    onCanvasKeyAction(listener) {
      canvasKeyActionListeners.add(listener);
      return () => canvasKeyActionListeners.delete(listener);
    },
    onStageActReady(listener) {
      stageReadyListeners.add(listener);
      return () => stageReadyListeners.delete(listener);
    },
    onStageInput(listener) {
      stageInputListeners.add(listener);
      return () => stageInputListeners.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      keyListeners.clear();
      geometryListeners.clear();
      textEditListeners.clear();
      awayListeners.clear();
      selectionListeners.clear();
      canvasKeyActionListeners.clear();
      stageReadyListeners.clear();
      stageInputListeners.clear();
      host.removeEventListener("message", onWindowMessage);
      if (watchedGeometry) {
        const stop = { kind: "watch-geometry", params: { handles: [] } };
        port?.postMessage({ v: EDITING_PROTOCOL_VERSION, id: ++lastId, ...stop });
      }
      offered?.close();
      rejectReady(new EditingPortError("disposed", "client disposed"));
      for (const id of [...pending.keys()]) {
        settle(id, { error: new EditingPortError("disposed", "client disposed") });
      }
    },
  };
}

export { elementHome, transformWDivisor, type MotionPathHome } from "./editing/motionPathHome";
export {
  MAX_CANVAS_KEY_COMBOS,
  type ArmCanvasKeysParams,
  type ArmCanvasKeysResult,
  type CanvasKeyActionEvent,
  type CanvasKeyNudgeCombo,
  type ResolveCanvasKeyActionParams,
  type ResolveCanvasKeyActionResult,
} from "./editing/canvasKeys";
export {
  caretRangeAt,
  takePlainTextOnly,
  textEditResult,
  type TextEditAwayEvent,
  type TextEditEndedEvent,
  type TextEditCaret,
  type TextEditResult,
  type TextEditSelection,
  type TextEditSelectionEvent,
} from "./editing/textEdit";
export {
  caretBoxIn,
  caretColorOf,
  caretSideAfterKey,
  placeCaretAtEnd,
  type CaretBox,
  type CaretSide,
} from "./editing/textCaret";
export {
  parsePausedFrameAsk,
  PAUSED_FRAME_BYTES,
  PAUSED_FRAME_PARAMS,
  PAUSED_FRAME_SOURCES,
  type PausedFrameAsk,
  type PausedFrameAskMessage,
  type PausedFrameImage,
  type PausedFrameReply,
} from "./editing/pausedFrames";
