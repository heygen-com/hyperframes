/** Bare keys Studio's hotkeys bind; the shortcuts list names them from here. */
export const STUDIO_PLAIN_KEYS = {
  fullscreen: "f",
  split: "s",
  record: "r",
  addKeyframe: "k",
  audioGain: "g",
} as const;

export interface ShortcutHint {
  key: string;
  label: string;
}

export interface ShortcutSection {
  title: string;
  hints: readonly ShortcutHint[];
}

const hintKey = (key: string) => key.toUpperCase();

/** What PlayerControls' shortcuts panel lists unless an embedder passes its own sections. */
export const DEFAULT_SHORTCUT_SECTIONS: readonly ShortcutSection[] = [
  {
    title: "Playback",
    hints: [
      { key: "Space", label: "Play / Pause" },
      { key: "J", label: "Play backward" },
      { key: "K", label: "Stop" },
      { key: "L", label: "Play forward" },
      { key: "M", label: "Toggle mute" },
      { key: "⇧L", label: "Toggle loop" },
      { key: "←/→", label: "Step 1 frame" },
      { key: "⇧←/⇧→", label: "Step 10 frames" },
      { key: hintKey(STUDIO_PLAIN_KEYS.fullscreen), label: "Toggle fullscreen" },
    ],
  },
  {
    title: "Keyframes (when an element is selected)",
    hints: [
      { key: hintKey(STUDIO_PLAIN_KEYS.addKeyframe), label: "Add / remove keyframe at playhead" },
      { key: "Del", label: "Delete selected keyframe" },
      { key: hintKey(STUDIO_PLAIN_KEYS.record), label: "Record gesture" },
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
      { key: hintKey(STUDIO_PLAIN_KEYS.split), label: "Split clip at playhead" },
      { key: hintKey(STUDIO_PLAIN_KEYS.audioGain), label: "Audio Gain for clips with sound" },
      { key: "⇧Click", label: "Razor tool: split all tracks" },
      { key: "[", label: "Select clips starting before the playhead" },
      { key: "]", label: "Select clips running at or after the playhead" },
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
      { key: "I", label: "Set in-point" },
      { key: "⇧I", label: "Clear in-point" },
      { key: "O", label: "Set out-point" },
      { key: "⇧O", label: "Clear out-point" },
      { key: "A", label: "Jump to in-point" },
      { key: "E", label: "Jump to out-point" },
    ],
  },
];
