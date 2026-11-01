import { useSyncExternalStore } from "react";
import { comboClashKey, comboText, formatCombo, matchCombo, parseCombo } from "./studioCombo";

/** Every single-character bare key Studio answers, by action. */
export const DEFAULT_STUDIO_KEYS = {
  fullscreen: "f",
  split: "s",
  record: "r",
  addKeyframe: "k",
  audioGain: "g",
  zoomSelection: "z",
  mute: "m",
  pause: "k",
  shuttleBack: "j",
  shuttleForward: "l",
  inPoint: "i",
  outPoint: "o",
  seekToIn: "a",
  seekToOut: "e",
  selectTool: "v",
  razorTool: "b",
  selectLeftward: "[",
  selectRightward: "]",
  exitRazor: "a",
  snap: "s",
  grid: "g",
  timelineSnap: "n",
};

export type StudioKeyAction = keyof typeof DEFAULT_STUDIO_KEYS;
export type StudioKeys = Readonly<Record<StudioKeyAction, string>>;

const SHARED_BY_DESIGN: ReadonlyArray<readonly [StudioKeyAction, StudioKeyAction]> = [
  ["pause", "addKeyframe"],
  ["seekToIn", "exitRazor"],
  ["split", "snap"],
  ["audioGain", "grid"],
];

let current: StudioKeys = DEFAULT_STUDIO_KEYS;
const listeners = new Set<() => void>();

const sharedByDesign = (a: StudioKeyAction, b: StudioKeyAction) =>
  SHARED_BY_DESIGN.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

function findClash(keys: StudioKeys): string | null {
  const actions = Object.keys(keys) as StudioKeyAction[];
  const clashKey = (action: StudioKeyAction) => comboClashKey(parseCombo(keys[action])!);
  for (const [i, a] of actions.entries()) {
    for (const b of actions.slice(i + 1)) {
      if (clashKey(a) === clashKey(b) && !sharedByDesign(a, b)) return `${a} and ${b} both on "${keys[a]}"`;
    }
  }
  return null;
}

function resolve(overrides: Partial<Record<StudioKeyAction, string>>): StudioKeys {
  const next: Record<string, string> = { ...DEFAULT_STUDIO_KEYS };
  for (const [action, text] of Object.entries(overrides)) {
    const combo = typeof text === "string" ? parseCombo(text) : null;
    if (!Object.hasOwn(DEFAULT_STUDIO_KEYS, action) || !combo) {
      console.warn(`Studio keys: using defaults, "${action}" is not a known action with a valid combo`);
      return DEFAULT_STUDIO_KEYS;
    }
    next[action] = comboText(combo);
  }
  const clash = findClash(next as StudioKeys);
  if (!clash) return next as StudioKeys;
  console.warn(`Studio keys: using defaults, ${clash}`);
  return DEFAULT_STUDIO_KEYS;
}

/** Replaces the host key map; a bad map is refused whole. null restores the defaults. */
export function setStudioKeys(overrides: Partial<Record<StudioKeyAction, string>> | null) {
  current = overrides ? resolve(overrides) : DEFAULT_STUDIO_KEYS;
  for (const listener of listeners) listener();
}

export const getStudioKeys = (): StudioKeys => current;
export const getStudioKey = (action: StudioKeyAction): string => current[action];

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const useStudioKeys = (): StudioKeys => useSyncExternalStore(subscribe, getStudioKeys);

export function useShortcutSections(host?: readonly ShortcutSection[]): readonly ShortcutSection[] {
  const keys = useStudioKeys();
  return host ?? buildShortcutSections(keys);
}

export interface ShortcutHint {
  key: string;
  label: string;
}

export interface ShortcutSection {
  title: string;
  hints: readonly ShortcutHint[];
}

export const keyHint = (action: StudioKeyAction, keys: StudioKeys = current) =>
  formatCombo(parseCombo(keys[action])!);

/** True when the event is the combo the host (or the default) set for this action. */
export const matchesKey = (e: KeyboardEvent, action: StudioKeyAction) =>
  matchCombo(e, parseCombo(current[action])!);

export function buildShortcutSections(keys: StudioKeys): readonly ShortcutSection[] {
  const k = (action: StudioKeyAction) => keyHint(action, keys);
  return [
    {
      title: "Playback",
      hints: [
        { key: "Space", label: "Play / Pause" },
        { key: k("shuttleBack"), label: "Play backward" },
        { key: k("pause"), label: "Stop" },
        { key: k("shuttleForward"), label: "Play forward" },
        { key: k("mute"), label: "Toggle mute" },
        { key: `⇧${k("shuttleForward")}`, label: "Toggle loop" },
        { key: "←/→", label: "Step 1 frame" },
        { key: "⇧←/⇧→", label: "Step 10 frames" },
        { key: k("fullscreen"), label: "Toggle fullscreen" },
      ],
    },
    {
      title: "Keyframes (when an element is selected)",
      hints: [
        { key: k("addKeyframe"), label: "Add / remove keyframe at playhead" },
        { key: "Del", label: "Delete selected keyframe" },
        { key: k("record"), label: "Record gesture" },
      ],
    },
    {
      title: "Editing",
      hints: [
        { key: "⌘Z", label: "Undo" },
        { key: "⌘⇧Z", label: "Redo" },
        { key: "⌘C", label: "Copy element" },
        { key: "⌘V", label: "Paste element" },
        { key: "⌘X", label: "Cut element" },
        { key: k("split"), label: "Split clip at playhead" },
        { key: k("zoomSelection"), label: "Zoom timeline to selected clips" },
        { key: k("audioGain"), label: "Audio Gain for clips with sound" },
        { key: "⇧Click", label: "Razor tool: split all tracks" },
        { key: k("selectLeftward"), label: "Select clips starting before the playhead" },
        { key: k("selectRightward"), label: "Select clips running at or after the playhead" },
        { key: "⌘G", label: "Group elements" },
        { key: "⌘⇧G", label: "Ungroup" },
        { key: "Del", label: "Delete selected element (no keyframe selected)" },
      ],
    },
    {
      title: "Gesture recording modifiers",
      hints: [
        { key: "Drag", label: "Record x / y position" },
        { key: "Scroll", label: "Record z depth" },
        { key: "⇧ Drag", label: "Record rotationX / rotationY" },
        { key: "⌥ Drag", label: "Record rotation" },
        { key: "⌘ Drag↕", label: "Record opacity" },
        { key: "⌘ Scroll", label: "Record scale" },
      ],
    },
    {
      title: "Canvas",
      hints: [
        { key: "Drag", label: "Move element / add keyframe" },
        { key: "⌥ Drag", label: "Move entire animation path" },
        { key: "⇧ Drag", label: "Uniform resize" },
      ],
    },
    {
      title: "Crop",
      hints: [
        { key: "Drag edge", label: "Crop a side" },
        { key: "Drag center", label: "Reposition the crop" },
      ],
    },
    {
      title: "Panels",
      hints: [
        { key: "⌘1", label: "Compositions tab" },
        { key: "⌘2", label: "Assets tab" },
      ],
    },
    {
      title: "Work area",
      hints: [
        { key: k("inPoint"), label: "Set in-point" },
        { key: `⇧${k("inPoint")}`, label: "Clear in-point" },
        { key: k("outPoint"), label: "Set out-point" },
        { key: `⇧${k("outPoint")}`, label: "Clear out-point" },
        { key: k("seekToIn"), label: "Jump to in-point" },
        { key: k("seekToOut"), label: "Jump to out-point" },
      ],
    },
  ];
}

export const getShortcutSections = () => buildShortcutSections(current);

export const DEFAULT_SHORTCUT_SECTIONS: readonly ShortcutSection[] =
  buildShortcutSections(DEFAULT_STUDIO_KEYS);
