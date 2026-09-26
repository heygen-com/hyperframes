// Studio's icon set. One 16-unit grid, 1-unit safe margin, drawn in
// currentColor. A glyph is a list of shapes: "M…" path data, "r x y w h rx"
// rounded rect, "R x y w h rx" filled rect, "c cx cy r" circle, "d cx cy r"
// filled dot. `small` replaces `shapes` below 14 px: fewer strokes, one mark.
export type Shape = string;

export interface Glyph {
  shapes: readonly Shape[];
  small?: readonly Shape[];
  /** Always painted solid (small carets). */
  solid?: true;
  /** Closed silhouette that reads when painted solid; `filled` is ignored elsewhere. */
  fillable?: true;
}

const FILE_BODY =
  "M9.5 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5v-7Z";
const FILE_FOLD = "M9.5 2v3.5H13";
const SMALL_FILE =
  "M9.5 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V6Z";
const FOLDER =
  "M2 4.5A1.5 1.5 0 0 1 3.5 3H6l1.5 1.5h5A1.5 1.5 0 0 1 14 6v6a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12Z";
const SPEAKER = "M2.5 6H5l3.5-3v10L5 10H2.5Z";
const DIAMOND = "M8 2.5 13.5 8 8 13.5 2.5 8Z";
const PANEL = "r 2 2.5 12 11 2";
const TRAY = "M2.5 11v1.5A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5V11";
const MAGNIFIER = ["c 7 7 4.5", "M10.5 10.5 14 14"];

export const GLYPHS = {
  // marks
  check: { shapes: ["M3.5 8.5 6.5 11.5 12.5 4.5"] },
  x: { shapes: ["M4 4l8 8M12 4l-8 8"] },
  plus: { shapes: ["M8 3v10M3 8h10"] },
  minus: { shapes: ["M3 8h10"] },
  "chevron-down": { shapes: ["M4 6l4 4 4-4"] },
  "chevron-up": { shapes: ["M4 10l4-4 4 4"] },
  "chevron-right": { shapes: ["M6 4l4 4-4 4"] },
  "chevron-left": { shapes: ["M10 4 6 8l4 4"] },
  "caret-down": { shapes: ["M4.5 6h7L8 10Z"], solid: true },
  "caret-up": { shapes: ["M4.5 10h7L8 6Z"], solid: true },
  "caret-right": { shapes: ["M6 4.5v7L10 8Z"], solid: true },
  "arrow-left": { shapes: ["M13 8H3", "M7 4 3 8l4 4"] },
  "arrow-right": { shapes: ["M3 8h10", "M9 4l4 4-4 4"] },
  "arrow-up": { shapes: ["M8 13V3", "M4 7l4-4 4 4"] },
  "arrow-down": { shapes: ["M8 3v10", "M4 9l4 4 4-4"] },
  grip: { shapes: ["M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01"] },
  // history and rotation
  undo: { shapes: ["M3 7h7a3.5 3.5 0 0 1 0 7H6", "M6 4 3 7l3 3"] },
  redo: { shapes: ["M13 7H6a3.5 3.5 0 0 0 0 7h4", "M10 4l3 3-3 3"] },
  "rotate-cw": { shapes: ["M13 8a5 5 0 1 1-1.5-3.5", "M9 4.5h2.5V2"] },
  "rotate-ccw": { shapes: ["M3 8a5 5 0 1 0 1.5-3.5", "M7 4.5H4.5V2"] },
  loop: {
    shapes: [
      "M3 6v-.5a2 2 0 0 1 2-2h8",
      "M11 1.5l2 2-2 2",
      "M13 10v.5a2 2 0 0 1-2 2H3",
      "M5 10.5l-2 2 2 2",
    ],
  },
  // editing
  select: { shapes: ["M3.5 2.5 12.5 8l-4 .8 2.2 4.2-1.7.8-2.2-4.1-3.3 2.8Z"], fillable: true },
  move: {
    shapes: [
      "M8 2v12M2 8h12",
      "M5.5 4.5 8 2l2.5 2.5M5.5 11.5 8 14l2.5-2.5M4.5 5.5 2 8l2.5 2.5M11.5 5.5 14 8l-2.5 2.5",
    ],
  },
  scissors: { shapes: ["c 4.5 4.5 2", "c 4.5 11.5 2", "M6 5.8 13.5 12M6 10.2 13.5 4"] },
  razor: { shapes: ["M9.8 2.7 13.3 6.2 6.2 13.3 2.7 9.8Z", "M6.2 9.8l3.6-3.6"], fillable: true },
  split: { shapes: ["M5.5 3h-2v10h2", "M10.5 3h2v10h-2", "M8 2v12"] },
  pencil: { shapes: ["M2.5 13.5 3 10.5l8-8a1.4 1.4 0 0 1 2.5 2.5l-8 8Z", "M9.5 4 12 6.5"] },
  eyedropper: {
    shapes: [
      "M2 14v-1.5l6-6L9.5 8l-6 6Z",
      "M7.5 6 10 8.5",
      "M8.5 5.5 11 3a1.4 1.4 0 0 1 2 2l-2.5 2.5Z",
    ],
  },
  link: {
    shapes: ["M6 11.5H4.5a3.5 3.5 0 0 1 0-7H6", "M10 4.5h1.5a3.5 3.5 0 0 1 0 7H10", "M5.5 8h5"],
  },
  unlink: {
    shapes: [
      "M6 11.5H4.5a3.5 3.5 0 0 1 0-7H6",
      "M10 4.5h1.5a3.5 3.5 0 0 1 0 7H10",
      "M5.5 8h1M9.5 8h1",
    ],
  },
  copy: {
    shapes: [
      "r 6 6 8 8 2",
      "M4 10h-.5A1.5 1.5 0 0 1 2 8.5v-5A1.5 1.5 0 0 1 3.5 2h5A1.5 1.5 0 0 1 10 3.5V4",
    ],
  },
  clipboard: {
    shapes: [
      "M5.5 3h-1A1.5 1.5 0 0 0 3 4.5V13a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 13V4.5A1.5 1.5 0 0 0 11.5 3h-1",
      "r 5.5 1.5 5 3 1",
      "M5.5 8h5M5.5 11h3",
    ],
  },
  trash: {
    shapes: ["M3 4.5h10", "M6.5 4.5v-2h3v2", "M4.5 4.5l.7 9h5.6l.7-9", "M7 7.5v3.5M9 7.5v3.5"],
  },
  group: {
    shapes: [
      "r 2 2 8 8 1.5",
      "M10 6h2.5A1.5 1.5 0 0 1 14 7.5v5a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 6 12.5V10",
    ],
  },
  ungroup: { shapes: ["r 2 2 5.5 5.5 1.5", "r 8.5 8.5 5.5 5.5 1.5"] },
  layers: {
    shapes: [
      "M8 2.5 13.5 5.25 8 8 2.5 5.25Z",
      "M2.5 8.5 8 11.25l5.5-2.75",
      "M2.5 11.75 8 14.5l5.5-2.75",
    ],
  },
  // Studio's existing z-order glyphs (CanvasContextMenu.tsx), kept verbatim.
  "bring-forward": {
    shapes: ["M3 11 L8 8.5 L13 11 L8 13.5 Z", "M8 8.5 L8 2", "M5.5 4.5 L8 2 L10.5 4.5"],
  },
  "send-backward": {
    shapes: ["M3 5 L8 2.5 L13 5 L8 7.5 Z", "M8 7.5 L8 14", "M5.5 11.5 L8 14 L10.5 11.5"],
  },
  "bring-to-front": {
    shapes: [
      "M3 9.5 L8 7 L13 9.5 L8 12 Z",
      "M3 12.5 L8 10 L13 12.5 L8 15 Z",
      "M8 12.5 L8 2",
      "M5.5 4.5 L8 2 L10.5 4.5",
    ],
  },
  "send-to-back": {
    shapes: [
      "M3 4 L8 1.5 L13 4 L8 6.5 Z",
      "M3 7 L8 4.5 L13 7 L8 9.5 Z",
      "M8 3.5 L8 14",
      "M5.5 11.5 L8 14 L10.5 11.5",
    ],
  },
  crosshair: { shapes: ["c 8 8 5", "M8 1.5V4M8 12v2.5M1.5 8H4M12 8h2.5", "d 8 8 1"] },
  sparkle: { shapes: ["M8 2l1.5 4.5L14 8l-4.5 1.5L8 14l-1.5-4.5L2 8l4.5-1.5Z"], fillable: true },
  // timeline
  keyframe: { shapes: [DIAMOND], fillable: true },
  "keyframe-auto": { shapes: [DIAMOND, "d 8 8 1.5"], fillable: true },
  marker: { shapes: ["M4 14V2.5h8L10 5.5 12 8.5H4"], fillable: true },
  beat: { shapes: ["M2 8h3l1.5-4 3 8L11 8h3"] },
  magnet: {
    shapes: ["M3 2.5h3.5V8a1.5 1.5 0 0 0 3 0V2.5H13V8A5 5 0 0 1 3 8Z", "M3 5.5h3.5M9.5 5.5H13"],
    fillable: true,
  },
  snap: { shapes: ["M11.5 2v12", "r 2.5 5.5 5 5 1.5", "M8.5 6.5 10 8l-1.5 1.5Z"], fillable: true },
  grid: { shapes: ["r 2 2 12 12 2", "M2 6h12M2 10h12M6 2v12M10 2v12"] },
  path: { shapes: ["M3.5 11.5C4 6 6.5 4.5 8 8s4 3.5 4.5-3", "c 2.5 12.5 1.25", "c 13.5 3.5 1.25"] },
  ruler: { shapes: ["r 2 5.5 12 5 1.5", "M5 5.5V8M8 5.5v3.5M11 5.5V8"] },
  "safe-frame": {
    shapes: [
      "M2 6V3.5A1.5 1.5 0 0 1 3.5 2H6",
      "M10 2h2.5A1.5 1.5 0 0 1 14 3.5V6",
      "M14 10v2.5a1.5 1.5 0 0 1-1.5 1.5H10",
      "M6 14H3.5A1.5 1.5 0 0 1 2 12.5V10",
    ],
  },
  waves: { shapes: ["M2 8c1.5-3 2.5-3 4 0s2.5 3 4 0 2.5-3 4 0"] },
  waveform: { shapes: ["M3 6v4M5.5 3.5v9M8 5.5v5M10.5 2.5v11M13 7v2"] },
  record: { shapes: ["c 8 8 5.5", "d 8 8 2.5"], fillable: true },
  clock: { shapes: ["c 8 8 6", "M8 4.5V8l2.5 1.5"] },
  // player
  play: { shapes: ["M4.5 2.5 13 8l-8.5 5.5Z"], fillable: true },
  pause: { shapes: ["r 3 2.5 3.5 11 1", "r 9.5 2.5 3.5 11 1"], fillable: true },
  fullscreen: { shapes: ["M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"] },
  "fullscreen-exit": { shapes: ["M6 2v4H2M14 6h-4V2M10 14v-4h4M2 10h4v4"] },
  "volume-high": {
    shapes: [SPEAKER, "M10.5 5.5a3.5 3.5 0 0 1 0 5", "M12.5 3.5a6.5 6.5 0 0 1 0 9"],
  },
  "volume-low": { shapes: [SPEAKER, "M10.5 5.5a3.5 3.5 0 0 1 0 5"] },
  "volume-mute": { shapes: [SPEAKER, "M10.5 6 14 9.5M14 6l-3.5 3.5"] },
  // media and files
  camera: {
    shapes: [
      "M2 5.5A1.5 1.5 0 0 1 3.5 4h2l1-1.5h3l1 1.5h2A1.5 1.5 0 0 1 14 5.5V12a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12Z",
      "c 8 8.5 2.5",
    ],
  },
  image: { shapes: [PANEL, "c 5.5 6 1.25", "M2 11.5 6 8l3 3 2-1.5 3 2.5"] },
  film: { shapes: ["r 2 3 12 10 2", "M5 3v10M11 3v10M2 6.5h3M2 9.5h3M11 6.5h3M11 9.5h3"] },
  music: { shapes: ["M6 12.5v-9l7-1.5V11", "c 4 12.5 2", "c 11 11 2"] },
  type: { shapes: ["M3 3.5h10", "M3 3.5v2M13 3.5v2", "M8 3.5V13", "M6 13h4"] },
  font: { shapes: ["M2 12l3-8 3 8", "M3.2 9h3.6", "c 11.5 9.5 2", "M13.5 7.5V12"] },
  folder: { shapes: [FOLDER], fillable: true },
  "folder-plus": { shapes: [FOLDER, "M8 7v4M6 9h4"] },
  file: { shapes: [FILE_BODY, FILE_FOLD], small: [SMALL_FILE] },
  "file-plus": { shapes: [FILE_BODY, FILE_FOLD, "M8 7.5v4M6 9.5h4"] },
  "file-code": {
    shapes: [FILE_BODY, FILE_FOLD, "M6 8.5 4.5 10 6 11.5M10 8.5l1.5 1.5-1.5 1.5"],
    small: [SMALL_FILE, "M6.5 7 4.5 9l2 2M9.5 7l2 2-2 2"],
  },
  "file-image": {
    shapes: [FILE_BODY, FILE_FOLD, "d 6.5 8.5 .9", "M5 12l2.5-2.5 2 2 1.5-1.5"],
    small: [SMALL_FILE, "d 6 7.5 1.1", "M4.5 12l3-3 2 2 2.5-2.5"],
  },
  "file-video": {
    shapes: [FILE_BODY, FILE_FOLD, "M6.5 8 10 10l-3.5 2Z"],
    small: [SMALL_FILE, "M6.5 6.5 10.5 9l-4 2.5Z"],
  },
  "file-audio": {
    shapes: [FILE_BODY, FILE_FOLD, "M5.5 9.5V11M8 8v4.5M10.5 9v2.5"],
    small: [SMALL_FILE, "M5.5 8v3M8 6.5v6M10.5 7.5v4"],
  },
  "file-text": {
    shapes: [FILE_BODY, FILE_FOLD, "M5.5 8.5h5M5.5 11h3"],
    small: [SMALL_FILE, "M5.5 7.5h5M5.5 10.5h3"],
  },
  "file-font": {
    shapes: [FILE_BODY, FILE_FOLD, "M6 12l2-5 2 5", "M6.8 10.5h2.4"],
    small: [SMALL_FILE, "M5.5 12l2.5-6 2.5 6M6.4 10h3.2"],
  },
  download: { shapes: ["M8 2.5v8", "M4.5 7 8 10.5 11.5 7", TRAY] },
  upload: { shapes: ["M8 10.5v-8", "M4.5 6 8 2.5 11.5 6", TRAY] },
  // chrome
  eye: {
    shapes: [
      "M1.5 8C3.5 4.5 5.5 3 8 3s4.5 1.5 6.5 5c-2 3.5-4 5-6.5 5S3.5 11.5 1.5 8Z",
      "c 8 8 2.5",
    ],
  },
  "eye-off": {
    shapes: [
      "M2.5 2.5l11 11",
      "M6.2 6.3a2.5 2.5 0 0 0 3.5 3.5",
      "M4.7 4.8C3.5 5.6 2.5 6.7 1.5 8c2 3.5 4 5 6.5 5 1.2 0 2.3-.3 3.3-.9",
      "M7 3.1c.3-.1.7-.1 1-.1 2.5 0 4.5 1.5 6.5 5-.6 1.1-1.3 2-2 2.8",
    ],
  },
  settings: {
    shapes: [
      "M12.9 7.01 14.47 7.35v1.3l-1.57.34-.73 1.77.86 1.35-.92.92-1.35-.86-1.77.73-.34 1.57h-1.3l-.34-1.57-1.77-.73-1.35.86-.92-.92.86-1.35-.73-1.77-1.57-.34v-1.3l1.57-.34.73-1.77-.86-1.35.92-.92 1.35.86 1.77-.73.34-1.57h1.3l.34 1.57 1.77.73 1.35-.86.92.92-.86 1.35Z",
      "c 8 8 2",
    ],
  },
  window: { shapes: [PANEL, "M2 6.5h12", "M7 6.5v7"] },
  "sidebar-show": { shapes: [PANEL, "M6.5 2.5v11"] },
  "sidebar-hide": { shapes: [PANEL, "R 2 2.5 4.5 11 2", "M6.5 2.5v11"] },
  inspector: { shapes: [PANEL, "R 9.5 2.5 4.5 11 2", "M9.5 2.5v11"] },
  compare: { shapes: ["r 2 2 12 12 2", "M2 8h12"] },
  square: { shapes: ["r 2.5 2.5 11 11 2"], fillable: true },
  palette: {
    shapes: [
      "M8 2C4.4 2 1.5 4.7 1.5 8S4.4 14 8 14c1 0 1.5-.7 1.5-1.5 0-1-1-1.5-1-2.5 0-1 .8-1.5 1.8-1.5H12c1.4 0 2.5-1.1 2.5-2.5C14.5 3.8 11.6 2 8 2Z",
      "d 5 7 1",
      "d 8 5 1",
      "d 11 6 1",
    ],
  },
  zap: { shapes: ["M9 1.5 3 9h5l-1 5.5L13 7H8Z"], fillable: true },
  search: { shapes: [...MAGNIFIER] },
  "zoom-in": { shapes: [...MAGNIFIER, "M5 7h4M7 5v4"] },
  "zoom-out": { shapes: [...MAGNIFIER, "M5 7h4"] },
  keyboard: { shapes: ["r 1.5 4 13 8.5 1.5", "M4 7h1M7 7h2M11 7h1M4.5 10h7"] },
  spinner: { shapes: ["M14 8A6 6 0 1 1 8 2"] },
  // status
  warning: { shapes: ["M8 2.5 14.5 13.5h-13Z", "M8 6.5v3", "d 8 12 .75"] },
  "check-circle": { shapes: ["c 8 8 6", "M5 8l2.2 2.2L11 6"] },
  "check-square": { shapes: ["r 2 2 12 12 2", "M5 8l2.2 2.2L11 6"] },
  "alert-circle": { shapes: ["c 8 8 6", "M8 5v3.5", "d 8 11 .75"] },
  "help-circle": { shapes: ["c 8 8 6", "M6 6.5a2 2 0 1 1 2.5 2c-.5.3-.5.7-.5 1.3", "d 8 12 .75"] },
} as const satisfies Record<string, Glyph>;

export type IconName = keyof typeof GLYPHS;
export const ICON_NAMES = Object.keys(GLYPHS) as IconName[];
