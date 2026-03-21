export const HYPERFRAME_RUNTIME_GLOBALS = {
  player: "__player",
  playerReady: "__playerReady",
  renderReady: "__renderReady",
  timelines: "__timelines",
  clipManifest: "__clipManifest",
} as const;

export const HYPERFRAME_BRIDGE_SOURCES = {
  parent: "hf-parent",
  preview: "hf-preview",
} as const;

export const HYPERFRAME_CONTROL_ACTIONS = [
  "play",
  "pause",
  "seek",
  "set-muted",
  "set-playback-rate",
  "enable-pick-mode",
  "disable-pick-mode",
] as const;

export type HyperframeControlAction = (typeof HYPERFRAME_CONTROL_ACTIONS)[number];
