/** Bare keys Studio's app hotkeys bind; the shortcuts list names them from here. */
export const STUDIO_PLAIN_KEYS = { fullscreen: "f", split: "s", record: "r" } as const;

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
      { key: "K", label: "Add keyframe at playhead" },
      { key: "Del", label: "Delete selected keyframe" },
      { key: "H", label: "Toggle hold / bezier" },
      { key: "U", label: "Expand / collapse properties" },
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
      { key: "⇧Click", label: "Razor tool: split all tracks" },
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
