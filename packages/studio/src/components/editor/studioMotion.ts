import type { DomEditSelection } from "./domEditing";

export const STUDIO_MOTION_PATH = ".hyperframes/studio-motion.json";
export const STUDIO_MOTION_TIMELINE_ID = "studio-motion";

const STUDIO_MOTION_ATTR = "data-hf-studio-motion";
const STUDIO_MOTION_ORIGINAL_TRANSFORM_ATTR = "data-hf-studio-motion-original-transform";
const STUDIO_MOTION_ORIGINAL_OPACITY_ATTR = "data-hf-studio-motion-original-opacity";
const STUDIO_MOTION_ORIGINAL_VISIBILITY_ATTR = "data-hf-studio-motion-original-visibility";

export interface StudioMotionTarget {
  sourceFile: string;
  selector?: string;
  selectorIndex?: number;
  id?: string;
}

export interface StudioGsapMotionValues {
  x?: number;
  y?: number;
  scale?: number;
  rotation?: number;
  opacity?: number;
  autoAlpha?: number;
}

export interface StudioGsapCustomEase {
  id: string;
  data: string;
}

export interface StudioCustomEaseControlPoints {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface StudioGsapMotion {
  kind: "gsap-motion";
  target: StudioMotionTarget;
  start: number;
  duration: number;
  ease: string;
  customEase?: StudioGsapCustomEase;
  from: StudioGsapMotionValues;
  to: StudioGsapMotionValues;
  updatedAt?: string;
}

export type StudioGsapMotionPreset = "fade-up" | "slide" | "pop";
export type StudioGsapMotionDirection = "up" | "down" | "left" | "right";

export const STUDIO_GSAP_EASE_OPTIONS = [
  "none",
  "power1.in",
  "power1.out",
  "power1.inOut",
  "power2.in",
  "power2.out",
  "power2.inOut",
  "power3.in",
  "power3.out",
  "power3.inOut",
  "power4.in",
  "power4.out",
  "power4.inOut",
  "sine.in",
  "sine.out",
  "sine.inOut",
  "expo.in",
  "expo.out",
  "expo.inOut",
  "circ.in",
  "circ.out",
  "circ.inOut",
  "back.in(1.7)",
  "back.out(1.7)",
  "back.inOut(1.7)",
  "elastic.out(1, 0.45)",
  "bounce.out",
] as const;

const DEFAULT_CUSTOM_EASE_POINTS: StudioCustomEaseControlPoints = {
  x1: 0.215,
  y1: 0.61,
  x2: 0.355,
  y2: 1,
};

const GSAP_EASE_CONTROL_POINTS: Record<string, StudioCustomEaseControlPoints> = {
  none: { x1: 0, y1: 0, x2: 1, y2: 1 },
  "power1.in": { x1: 0.55, y1: 0.085, x2: 0.68, y2: 0.53 },
  "power1.out": { x1: 0.25, y1: 0.46, x2: 0.45, y2: 0.94 },
  "power1.inOut": { x1: 0.455, y1: 0.03, x2: 0.515, y2: 0.955 },
  "power2.in": { x1: 0.55, y1: 0.055, x2: 0.675, y2: 0.19 },
  "power2.out": { x1: 0.215, y1: 0.61, x2: 0.355, y2: 1 },
  "power2.inOut": { x1: 0.645, y1: 0.045, x2: 0.355, y2: 1 },
  "power3.in": { x1: 0.895, y1: 0.03, x2: 0.685, y2: 0.22 },
  "power3.out": { x1: 0.165, y1: 0.84, x2: 0.44, y2: 1 },
  "power3.inOut": { x1: 0.77, y1: 0, x2: 0.175, y2: 1 },
  "power4.in": { x1: 0.755, y1: 0.05, x2: 0.855, y2: 0.06 },
  "power4.out": { x1: 0.23, y1: 1, x2: 0.32, y2: 1 },
  "power4.inOut": { x1: 0.86, y1: 0, x2: 0.07, y2: 1 },
  "sine.in": { x1: 0.47, y1: 0, x2: 0.745, y2: 0.715 },
  "sine.out": { x1: 0.39, y1: 0.575, x2: 0.565, y2: 1 },
  "sine.inOut": { x1: 0.445, y1: 0.05, x2: 0.55, y2: 0.95 },
  "expo.in": { x1: 0.95, y1: 0.05, x2: 0.795, y2: 0.035 },
  "expo.out": { x1: 0.19, y1: 1, x2: 0.22, y2: 1 },
  "expo.inOut": { x1: 1, y1: 0, x2: 0, y2: 1 },
  "circ.in": { x1: 0.6, y1: 0.04, x2: 0.98, y2: 0.335 },
  "circ.out": { x1: 0.075, y1: 0.82, x2: 0.165, y2: 1 },
  "circ.inOut": { x1: 0.785, y1: 0.135, x2: 0.15, y2: 0.86 },
  "back.in(1.7)": { x1: 0.6, y1: -0.28, x2: 0.735, y2: 0.045 },
  "back.out(1.7)": { x1: 0.175, y1: 0.885, x2: 0.32, y2: 1.275 },
  "back.inOut(1.7)": { x1: 0.68, y1: -0.55, x2: 0.265, y2: 1.55 },
  "elastic.out(1, 0.45)": { x1: 0.16, y1: 1.32, x2: 0.28, y2: 0.86 },
  "bounce.out": { x1: 0.34, y1: 1.56, x2: 0.64, y2: 0.74 },
};

const CUSTOM_EASE_DATA_PATTERN =
  /^M\s*0\s*,\s*0\s*C\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s+1\s*,\s*1\s*$/i;

export interface StudioGsapPresetMotionOptions {
  start: number;
  duration: number;
  distance: number;
  ease: string;
  direction?: StudioGsapMotionDirection;
  customEase?: StudioGsapCustomEase;
}

export interface StudioMotionManifest {
  version: 1;
  motions: StudioGsapMotion[];
}

interface StudioGsapTimeline {
  fromTo?: (
    target: HTMLElement,
    from: Record<string, unknown>,
    to: Record<string, unknown>,
    at: number,
  ) => StudioGsapTimeline;
  time?: (time: number) => StudioGsapTimeline;
  totalTime?: (time: number, suppressEvents?: boolean) => StudioGsapTimeline;
  pause?: () => StudioGsapTimeline;
  kill?: () => void;
  duration?: () => number;
}

type StudioMotionWindow = Window & {
  gsap?: {
    timeline?: (vars?: Record<string, unknown>) => StudioGsapTimeline;
    set?: (target: HTMLElement, vars: Record<string, unknown>) => void;
    registerPlugin?: (...plugins: unknown[]) => void;
  };
  CustomEase?: { create?: (id: string, data: string) => void };
  __player?: {
    getTime?: () => number;
    renderSeek?: (time: number) => void;
    seek?: (time: number) => void;
  };
  __timeline?: { time?: () => number };
  __timelines?: Record<string, StudioGsapTimeline | undefined>;
  __hfStudioMotionApply?: () => number;
  __hfStudioMotionWrapped?: boolean;
};

export function emptyStudioMotionManifest(): StudioMotionManifest {
  return { version: 1, motions: [] };
}

function clampPositiveNumber(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clampNonNegativeNumber(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function sanitizeEase(value: string): string {
  return value.trim() || "none";
}

function roundEaseNumber(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clampRange(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function clampStudioCustomEasePoints(
  points: Partial<StudioCustomEaseControlPoints>,
): StudioCustomEaseControlPoints {
  return {
    x1: roundEaseNumber(clampRange(points.x1 ?? DEFAULT_CUSTOM_EASE_POINTS.x1, 0, 1, 0.215)),
    y1: roundEaseNumber(clampRange(points.y1 ?? DEFAULT_CUSTOM_EASE_POINTS.y1, -0.6, 1.6, 0.61)),
    x2: roundEaseNumber(clampRange(points.x2 ?? DEFAULT_CUSTOM_EASE_POINTS.x2, 0, 1, 0.355)),
    y2: roundEaseNumber(clampRange(points.y2 ?? DEFAULT_CUSTOM_EASE_POINTS.y2, -0.6, 1.6, 1)),
  };
}

export function parseStudioCustomEaseData(
  data: string | undefined,
): StudioCustomEaseControlPoints | null {
  if (!data) return null;
  const match = data.trim().match(CUSTOM_EASE_DATA_PATTERN);
  if (!match) return null;
  const points = {
    x1: Number.parseFloat(match[1] ?? ""),
    y1: Number.parseFloat(match[2] ?? ""),
    x2: Number.parseFloat(match[3] ?? ""),
    y2: Number.parseFloat(match[4] ?? ""),
  };
  if (!Object.values(points).every(Number.isFinite)) return null;
  return clampStudioCustomEasePoints(points);
}

function formatEaseNumber(value: number): string {
  const rounded = roundEaseNumber(value);
  if (Object.is(rounded, -0)) return "0";
  return `${rounded}`;
}

export function serializeStudioCustomEaseData(points: StudioCustomEaseControlPoints): string {
  const clamped = clampStudioCustomEasePoints(points);
  return `M0,0 C${formatEaseNumber(clamped.x1)},${formatEaseNumber(clamped.y1)} ${formatEaseNumber(clamped.x2)},${formatEaseNumber(clamped.y2)} 1,1`;
}

export function controlPointsForGsapEase(ease: string): StudioCustomEaseControlPoints {
  return GSAP_EASE_CONTROL_POINTS[ease] ?? DEFAULT_CUSTOM_EASE_POINTS;
}

export function buildStudioGsapPresetMotion(
  preset: StudioGsapMotionPreset,
  options: StudioGsapPresetMotionOptions,
): Omit<StudioGsapMotion, "kind" | "target" | "updatedAt"> {
  const start = clampNonNegativeNumber(options.start, 0);
  const duration = clampPositiveNumber(options.duration, 0.6);
  const distance = clampPositiveNumber(options.distance, 32);
  const ease = sanitizeEase(options.ease);
  const direction = options.direction ?? "up";
  const base = { start, duration, ease, customEase: options.customEase };

  if (preset === "pop") {
    return {
      ...base,
      from: { scale: 0.88, autoAlpha: 0 },
      to: { scale: 1, autoAlpha: 1 },
    };
  }

  if (preset === "slide") {
    const x = direction === "right" ? -distance : direction === "left" ? distance : 0;
    const y = direction === "down" ? -distance : direction === "up" ? distance : 0;
    return {
      ...base,
      from: { x, y, autoAlpha: 0 },
      to: { x: 0, y: 0, autoAlpha: 1 },
    };
  }

  return {
    ...base,
    from: { y: direction === "down" ? -distance : distance, autoAlpha: 0 },
    to: { y: 0, autoAlpha: 1 },
  };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseMotionValues(value: unknown): StudioGsapMotionValues | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const parsed: StudioGsapMotionValues = {};
  for (const key of ["x", "y", "scale", "rotation", "opacity", "autoAlpha"] as const) {
    const next = finiteNumber(record[key]);
    if (next != null) parsed[key] = next;
  }
  return Object.keys(parsed).length > 0 ? parsed : null;
}

function parseTarget(value: unknown): StudioMotionTarget | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const sourceFile = typeof record.sourceFile === "string" ? record.sourceFile : "";
  if (!sourceFile) return null;
  const selector = typeof record.selector === "string" ? record.selector : undefined;
  const id = typeof record.id === "string" ? record.id : undefined;
  if (!selector && !id) return null;
  return {
    sourceFile,
    selector,
    selectorIndex: finiteNumber(record.selectorIndex) ?? undefined,
    id,
  };
}

function parseCustomEase(value: unknown): StudioGsapCustomEase | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const data = typeof record.data === "string" ? record.data.trim() : "";
  if (!id || !data) return undefined;
  return { id, data };
}

function parseGsapMotion(value: unknown): StudioGsapMotion | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.kind !== "gsap-motion") return null;
  const target = parseTarget(record.target);
  if (!target) return null;
  const start = finiteNumber(record.start);
  const duration = finiteNumber(record.duration);
  if (start == null || duration == null || start < 0 || duration <= 0) return null;
  const ease = typeof record.ease === "string" && record.ease.trim() ? record.ease.trim() : "none";
  const from = parseMotionValues(record.from);
  const to = parseMotionValues(record.to);
  if (!from || !to) return null;
  return {
    kind: "gsap-motion",
    target,
    start,
    duration,
    ease,
    customEase: parseCustomEase(record.customEase),
    from,
    to,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined,
  };
}

export function parseStudioMotionManifest(content: string): StudioMotionManifest {
  if (!content.trim()) return emptyStudioMotionManifest();
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== "object") return emptyStudioMotionManifest();
    const motions = (parsed as { motions?: unknown }).motions;
    if (!Array.isArray(motions)) return emptyStudioMotionManifest();
    return {
      version: 1,
      motions: motions
        .map(parseGsapMotion)
        .filter((motion): motion is StudioGsapMotion => motion !== null),
    };
  } catch {
    return emptyStudioMotionManifest();
  }
}

export function serializeStudioMotionManifest(manifest: StudioMotionManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function normalizeStudioFileChangePath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "");
}

export function isStudioMotionManifestPath(path: string | null): boolean {
  if (!path) return false;
  const normalized = normalizeStudioFileChangePath(path);
  return normalized === STUDIO_MOTION_PATH || normalized.endsWith(`/${STUDIO_MOTION_PATH}`);
}

function selectionTarget(selection: DomEditSelection): StudioMotionTarget {
  return {
    sourceFile: selection.sourceFile || "index.html",
    selector: selection.selector,
    selectorIndex: selection.selectorIndex,
    id: selection.id ?? undefined,
  };
}

function targetKey(target: StudioMotionTarget): string {
  return [
    target.sourceFile,
    target.id ? `id:${target.id}` : "",
    target.selector ? `selector:${target.selector}` : "",
    target.selectorIndex != null ? `index:${target.selectorIndex}` : "",
  ].join("|");
}

function sameSelectionTarget(motion: StudioGsapMotion, selection: DomEditSelection): boolean {
  const target = selectionTarget(selection);
  if (motion.target.sourceFile !== target.sourceFile) return false;
  if (motion.target.id && target.id && motion.target.id === target.id) return true;
  return targetKey(motion.target) === targetKey(target);
}

export function upsertStudioGsapMotion(
  manifest: StudioMotionManifest,
  selection: DomEditSelection,
  motion: Omit<StudioGsapMotion, "kind" | "target" | "updatedAt">,
): StudioMotionManifest {
  const target = selectionTarget(selection);
  const nextMotion: StudioGsapMotion = {
    kind: "gsap-motion",
    target,
    ...motion,
    updatedAt: new Date().toISOString(),
  };
  return {
    version: 1,
    motions: [
      ...manifest.motions.filter((existing) => targetKey(existing.target) !== targetKey(target)),
      nextMotion,
    ],
  };
}

export function removeStudioMotionForSelection(
  manifest: StudioMotionManifest,
  selection: DomEditSelection,
): StudioMotionManifest {
  return {
    version: 1,
    motions: manifest.motions.filter((motion) => !sameSelectionTarget(motion, selection)),
  };
}

export function getStudioMotionForSelection(
  manifest: StudioMotionManifest,
  selection: DomEditSelection,
): StudioGsapMotion | null {
  return manifest.motions.find((motion) => sameSelectionTarget(motion, selection)) ?? null;
}

function sourceFileForElement(element: HTMLElement, activeCompositionPath: string | null): string {
  let current: HTMLElement | null = element;
  while (current) {
    const sourceFile =
      current.getAttribute("data-composition-file") ?? current.getAttribute("data-composition-src");
    if (sourceFile) return sourceFile;
    current = current.parentElement;
  }
  return activeCompositionPath ?? "index.html";
}

function elementMatchesSourceFile(
  element: HTMLElement,
  sourceFile: string,
  activeCompositionPath: string | null,
): boolean {
  return sourceFileForElement(element, activeCompositionPath) === sourceFile;
}

function querySelectorCandidates(document: Document, selector: string): HTMLElement[] {
  const isCandidate = (element: Element): element is HTMLElement => {
    const HTMLElementCtor = element.ownerDocument.defaultView?.HTMLElement;
    return Boolean(HTMLElementCtor && element instanceof HTMLElementCtor);
  };
  const className = selector.match(/^\.([A-Za-z0-9_-]+)$/)?.[1];
  if (className) {
    return Array.from(document.getElementsByTagName("*")).filter(
      (element): element is HTMLElement =>
        isCandidate(element) && element.classList.contains(className),
    );
  }
  if (/^[A-Za-z][A-Za-z0-9-]*$/.test(selector)) {
    return Array.from(document.getElementsByTagName(selector)).filter(isCandidate);
  }
  return Array.from(document.querySelectorAll(selector)).filter(isCandidate);
}

function resolveTarget(
  document: Document,
  target: StudioMotionTarget,
  activeCompositionPath: string | null,
): HTMLElement | null {
  const HTMLElementCtor = document.defaultView?.HTMLElement;
  if (target.id) {
    const byId = document.getElementById(target.id);
    if (
      HTMLElementCtor &&
      byId instanceof HTMLElementCtor &&
      elementMatchesSourceFile(byId, target.sourceFile, activeCompositionPath)
    ) {
      return byId;
    }
  }
  if (!target.selector) return null;
  try {
    const matches = querySelectorCandidates(document, target.selector).filter((element) =>
      elementMatchesSourceFile(element, target.sourceFile, activeCompositionPath),
    );
    return matches[Math.max(0, Math.floor(target.selectorIndex ?? 0))] ?? null;
  } catch {
    return null;
  }
}

function captureOriginalMotionStyles(element: HTMLElement): void {
  if (element.hasAttribute(STUDIO_MOTION_ATTR)) return;
  element.setAttribute(STUDIO_MOTION_ORIGINAL_TRANSFORM_ATTR, element.style.transform);
  element.setAttribute(STUDIO_MOTION_ORIGINAL_OPACITY_ATTR, element.style.opacity);
  element.setAttribute(STUDIO_MOTION_ORIGINAL_VISIBILITY_ATTR, element.style.visibility);
}

function restoreStudioMotionElement(element: HTMLElement, gsap: StudioMotionWindow["gsap"]): void {
  if (!element.hasAttribute(STUDIO_MOTION_ATTR)) return;
  gsap?.set?.(element, { clearProps: "transform,opacity,visibility" });
  element.style.transform = element.getAttribute(STUDIO_MOTION_ORIGINAL_TRANSFORM_ATTR) ?? "";
  element.style.opacity = element.getAttribute(STUDIO_MOTION_ORIGINAL_OPACITY_ATTR) ?? "";
  element.style.visibility = element.getAttribute(STUDIO_MOTION_ORIGINAL_VISIBILITY_ATTR) ?? "";
  element.removeAttribute(STUDIO_MOTION_ATTR);
  element.removeAttribute(STUDIO_MOTION_ORIGINAL_TRANSFORM_ATTR);
  element.removeAttribute(STUDIO_MOTION_ORIGINAL_OPACITY_ATTR);
  element.removeAttribute(STUDIO_MOTION_ORIGINAL_VISIBILITY_ATTR);
}

function restoreStudioMotionElements(document: Document, gsap: StudioMotionWindow["gsap"]): void {
  const HTMLElementCtor = document.defaultView?.HTMLElement;
  if (!HTMLElementCtor) return;
  for (const element of Array.from(document.querySelectorAll(`[${STUDIO_MOTION_ATTR}]`))) {
    if (element instanceof HTMLElementCtor) restoreStudioMotionElement(element, gsap);
  }
}

function resolveGsapEase(win: StudioMotionWindow, motion: StudioGsapMotion): string {
  const customEase = motion.customEase;
  if (!customEase) return motion.ease;
  const customEasePlugin = win.CustomEase;
  if (typeof customEasePlugin?.create !== "function") return motion.ease;
  try {
    win.gsap?.registerPlugin?.(customEasePlugin);
    customEasePlugin.create(customEase.id, customEase.data);
    return customEase.id;
  } catch {
    return motion.ease;
  }
}

function readCurrentTime(win: StudioMotionWindow, fallback?: number): number {
  if (typeof fallback === "number" && Number.isFinite(fallback)) return Math.max(0, fallback);
  try {
    const playerTime = win.__player?.getTime?.();
    if (typeof playerTime === "number" && Number.isFinite(playerTime))
      return Math.max(0, playerTime);
  } catch {
    // fall through
  }
  try {
    const timelineTime = win.__timeline?.time?.();
    if (typeof timelineTime === "number" && Number.isFinite(timelineTime)) {
      return Math.max(0, timelineTime);
    }
  } catch {
    // fall through
  }
  return 0;
}

export function applyStudioMotionManifest(
  document: Document,
  manifest: StudioMotionManifest,
  activeCompositionPath: string | null = null,
  currentTime?: number,
): number {
  const win = document.defaultView as StudioMotionWindow | null;
  if (!win) return 0;
  const gsap = win.gsap;
  win.__timelines = win.__timelines ?? {};
  win.__timelines[STUDIO_MOTION_TIMELINE_ID]?.kill?.();
  delete win.__timelines[STUDIO_MOTION_TIMELINE_ID];
  restoreStudioMotionElements(document, gsap);
  if (!gsap?.timeline || manifest.motions.length === 0) return 0;

  const timeline = gsap.timeline({
    paused: true,
    defaults: { overwrite: "auto" },
  });
  let applied = 0;
  for (const motion of manifest.motions) {
    const element = resolveTarget(document, motion.target, activeCompositionPath);
    if (!element || !timeline.fromTo) continue;
    captureOriginalMotionStyles(element);
    element.setAttribute(STUDIO_MOTION_ATTR, "true");
    const fromVars: Record<string, unknown> = { ...motion.from };
    const toVars: Record<string, unknown> = {
      ...motion.to,
      duration: motion.duration,
      ease: resolveGsapEase(win, motion),
      overwrite: "auto",
      immediateRender: false,
    };
    timeline.fromTo(element, fromVars, toVars, motion.start);
    applied += 1;
  }

  if (applied === 0) {
    timeline.kill?.();
    return 0;
  }
  win.__timelines[STUDIO_MOTION_TIMELINE_ID] = timeline;
  timeline.pause?.();
  const safeTime = readCurrentTime(win, currentTime);
  if (timeline.totalTime) timeline.totalTime(safeTime, false);
  else timeline.time?.(safeTime);
  return applied;
}

export function installStudioMotionSeekReapply(win: Window, apply: () => void): boolean {
  const studioWin = win as StudioMotionWindow;
  studioWin.__hfStudioMotionApply = () => {
    apply();
    return 0;
  };
  if (studioWin.__hfStudioMotionWrapped) return false;
  const player = studioWin.__player;
  if (!player) return false;

  const wrapPlayerMethod = (key: "renderSeek" | "seek") => {
    const original = player[key];
    if (typeof original !== "function") return;
    player[key] = (time: number) => {
      original.call(player, time);
      studioWin.__hfStudioMotionApply?.();
    };
  };
  wrapPlayerMethod("renderSeek");
  wrapPlayerMethod("seek");
  studioWin.__hfStudioMotionWrapped = true;
  return true;
}
