// ── Shared cross-package types ──────────────────────────────────────────────

export type ExecutionMode = "planning" | "design" | "execution" | null;

/** Video orientation / aspect ratio. */
export type Orientation = "16:9" | "9:16";

export interface Asset {
  id: string;
  url: string;
  type: string;
  is_reference?: boolean;
  /** Duration in seconds for video/audio assets */
  duration?: number;
}

// ── Timeline types ──────────────────────────────────────────────────────────

export type TimelineElementType = "video" | "image" | "text" | "audio" | "composition";
export type MediaElementType = "video" | "image" | "audio";

export type CanvasResolution = "landscape" | "portrait";

export const CANVAS_DIMENSIONS = {
  landscape: { width: 1920, height: 1080 },
  portrait: { width: 1080, height: 1920 },
} as const;

export interface TimelineElementBase {
  id: string;
  type: TimelineElementType;
  name: string;
  startTime: number;
  duration: number;
  zIndex: number;
  x?: number;
  y?: number;
  scale?: number;
  opacity?: number;
}

export interface TimelineMediaElement extends TimelineElementBase {
  type: MediaElementType;
  src: string;
  mediaStartTime?: number;
  sourceDuration?: number;
  isAroll?: boolean;
  sourceWidth?: number;
  sourceHeight?: number;
  volume?: number; // 0-1 (0% to 100%), default 1.0
  hasAudio?: boolean; // For videos - indicates if video has audio track
}

export interface WaveformData {
  peaks: number[];
  duration: number;
  sampleRate?: number;
}

export interface TimelineTextElement extends TimelineElementBase {
  type: "text";
  content: string;
  color?: string;
  fontSize?: number;
  textShadow?: boolean;
  fontFamily?: string;
  fontWeight?: number;
  textOutline?: boolean;
  textOutlineColor?: string;
  textOutlineWidth?: number;
  textHighlight?: boolean;
  textHighlightColor?: string;
  textHighlightPadding?: number;
  textHighlightRadius?: number;
}

export interface TimelineCompositionElement extends TimelineElementBase {
  type: "composition";
  src: string;
  compositionId: string;
  scale?: number;
  sourceDuration?: number;
  variableValues?: Record<string, string | number | boolean>;
  sourceWidth?: number;
  sourceHeight?: number;
}

// Composition Variable Types
export type CompositionVariableType = "string" | "number" | "color" | "boolean" | "enum";

export interface CompositionVariableBase {
  id: string;
  type: CompositionVariableType;
  label: string;
  description?: string;
}

export interface StringVariable extends CompositionVariableBase {
  type: "string";
  default: string;
  placeholder?: string;
  maxLength?: number;
}

export interface NumberVariable extends CompositionVariableBase {
  type: "number";
  default: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}

export interface ColorVariable extends CompositionVariableBase {
  type: "color";
  default: string;
}

export interface BooleanVariable extends CompositionVariableBase {
  type: "boolean";
  default: boolean;
}

export interface EnumVariable extends CompositionVariableBase {
  type: "enum";
  default: string;
  options: { value: string; label: string }[];
}

export type CompositionVariable =
  | StringVariable
  | NumberVariable
  | ColorVariable
  | BooleanVariable
  | EnumVariable;

export interface CompositionSpec {
  id: string;
  duration: number;
  variables: CompositionVariable[];
}

export function isStringVariable(v: CompositionVariable): v is StringVariable {
  return v.type === "string";
}

export function isNumberVariable(v: CompositionVariable): v is NumberVariable {
  return v.type === "number";
}

export function isColorVariable(v: CompositionVariable): v is ColorVariable {
  return v.type === "color";
}

export function isBooleanVariable(v: CompositionVariable): v is BooleanVariable {
  return v.type === "boolean";
}

export function isEnumVariable(v: CompositionVariable): v is EnumVariable {
  return v.type === "enum";
}

export type TimelineElement =
  | TimelineMediaElement
  | TimelineTextElement
  | TimelineCompositionElement;

export function isTextElement(el: TimelineElement): el is TimelineTextElement {
  return el.type === "text";
}

export function isMediaElement(el: TimelineElement): el is TimelineMediaElement {
  return el.type === "video" || el.type === "image" || el.type === "audio";
}

export function isCompositionElement(el: TimelineElement): el is TimelineCompositionElement {
  return el.type === "composition";
}

export interface MediaFile {
  id: string;
  name: string;
  type: TimelineElementType;
  src: string;
  file?: File;
  duration?: number;
  compositionId?: string;
  sourceWidth?: number; // Intrinsic width for compositions
  sourceHeight?: number; // Intrinsic height for compositions
}

export const TIMELINE_COLORS: Record<TimelineElementType, string> = {
  video: "#ec4899",
  image: "#3b82f6",
  text: "#06b6d4",
  audio: "#10b981",
  composition: "#f97316",
};

export const DEFAULT_DURATIONS: Record<TimelineElementType, number> = {
  video: 5,
  image: 5,
  text: 2,
  audio: 5,
  composition: 5,
};

export interface CompositionAPI {
  id: string;
  duration: number;
  seek(time: number): void;
  getTime(): number;
  getDuration(): number;
}

// ── Player API types (used by runtime) ────────────────────────────────────

export interface PlayerAPI {
  play(): void;
  pause(): void;
  seek(time: number): void;
  getTime(): number;
  getDuration(): number;
  isPlaying(): boolean;
  getMainTimeline(): unknown;
  getElementBounds(elementId: string): void;
  getElementsAtPoint(x: number, y: number): void;
  setElementPosition(elementId: string, x: number, y: number): void;
  previewElementPosition(elementId: string, x: number, y: number): void;
  setElementKeyframes(
    elementId: string,
    keyframes: Array<{
      id: string;
      time: number;
      properties: { x?: number; y?: number };
    }> | null,
  ): void;
  setElementScale(elementId: string, scale: number): void;
  setElementFontSize(elementId: string, fontSize: number): void;
  setElementTextContent(elementId: string, content: string): void;
  setElementTextColor(elementId: string, color: string): void;
  setElementTextShadow(elementId: string, enabled: boolean): void;
  setElementTextFontWeight(elementId: string, weight: number): void;
  setElementTextFontFamily(elementId: string, fontFamily: string): void;
  setElementTextOutline(elementId: string, enabled: boolean, color?: string, width?: number): void;
  setElementTextHighlight(
    elementId: string,
    enabled: boolean,
    color?: string,
    padding?: number,
    radius?: number,
  ): void;
  setElementVolume(elementId: string, volume: number): void;
  setStageZoom(scale: number, focusX: number, focusY: number): void;
  getStageZoom(): { scale: number; focusX: number; focusY: number };
  setStageZoomKeyframes(
    keyframes: Array<{
      id: string;
      time: number;
      zoom: { scale: number; focusX: number; focusY: number };
      ease?: string;
    }> | null,
  ): void;
  getStageZoomKeyframes(): Array<{
    id: string;
    time: number;
    zoom: { scale: number; focusX: number; focusY: number };
    ease?: string;
  }>;
  addElement(data: AddElementData): boolean;
  removeElement(elementId: string): boolean;
  updateElementTiming(elementId: string, start?: number, end?: number): boolean;
  setElementTiming(
    elementId: string,
    startTime: number,
    duration: number,
    mediaStartTime?: number,
  ): void;
  updateElementSrc(elementId: string, src: string): boolean;
  updateElementLayer(elementId: string, zIndex: number): boolean;
  updateElementBasePosition(elementId: string, x?: number, y?: number, scale?: number): boolean;
  markTimelineDirty(): void;
  isTimelineDirty(): boolean;
  rebuildTimeline(): void;
  ensureTimeline(): void;
  enableRenderMode(): void;
  disableRenderMode(): void;
  renderSeek(time: number): void;
  getElementVisibility(elementId: string): { visible: boolean; opacity?: number };
  getVisibleElements(): Array<{ id: string; tagName: string; start: number; end: number }>;
  getRenderState(): {
    time: number;
    duration: number;
    isPlaying: boolean;
    renderMode: boolean;
    timelineDirty: boolean;
  };
}

export interface AddElementData {
  id: string;
  type: "video" | "image" | "text" | "audio" | "composition";
  name?: string;
  src?: string;
  content?: string;
  start: number;
  end: number;
  zIndex?: number;
  x?: number;
  y?: number;
  scale?: number;
  fontSize?: number;
  color?: string;
  textShadow?: boolean;
  fontWeight?: number;
  textOutline?: boolean;
  textOutlineColor?: string;
  textOutlineWidth?: number;
  textHighlight?: boolean;
  textHighlightColor?: string;
  textHighlightPadding?: number;
  textHighlightRadius?: number;
  compositionId?: string;
  sourceWidth?: number;
  sourceHeight?: number;
  isAroll?: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface CompositionAsset {
  id: string;
  name: string;
  type: "composition";
  src: string;
  duration: number;
  compositionId: string;
  thumbnail?: string;
}

export interface Keyframe {
  id: string;
  time: number;
  properties: Partial<KeyframeProperties>;
  ease?: string;
}

export interface KeyframeProperties {
  x: number;
  y: number;
  opacity: number;
  scale: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  width: number;
  height: number;
}

export interface ElementKeyframes {
  elementId: string;
  keyframes: Keyframe[];
}

export interface StageZoom {
  scale: number;
  focusX: number;
  focusY: number;
}

export interface StageZoomKeyframe {
  id: string;
  time: number;
  zoom: StageZoom;
  ease?: string;
}

export function getDefaultStageZoom(resolution: CanvasResolution): StageZoom {
  const { width, height } = CANVAS_DIMENSIONS[resolution];
  return {
    scale: 1,
    focusX: width / 2,
    focusY: height / 2,
  };
}
