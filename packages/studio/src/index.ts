// NLE Layout
export { EditorShell } from "./components/EditorShell";
export type { EditorShellProps } from "./components/EditorShell";
export { NLEPreview } from "./components/nle/NLEPreview";
export { CompositionBreadcrumb } from "./components/nle/CompositionBreadcrumb";
export type { CompositionLevel } from "./components/nle/CompositionBreadcrumb";

// Player (preview, timeline, playback controls)
export {
  Player,
  PlayerControls,
  Timeline,
  VideoThumbnail,
  CompositionThumbnail,
  useTimelinePlayer,
  resolveIframe,
  usePlayerStore,
  liveTime,
  formatTime,
} from "./player";
export type { TimelineElement } from "./player";

// Host overlays: draw over the preview in composition coordinates (see EditorShellProps.gestureOverlay)
export { usePreviewCompositionRect } from "./components/editor/usePreviewCompositionRect";
export type { PreviewCompositionRect } from "./components/editor/usePreviewCompositionRect";

// Editor
export { SourceEditor } from "./components/editor/SourceEditor";
export { PropertyPanel } from "./components/editor/PropertyPanel";
export { FileTree } from "./components/editor/FileTree";

// App
export { StudioApp } from "./App";

// Ask-agent flow
export { AskAgentModal } from "./components/AskAgentModal";
export type { AskAgentModalProps } from "./components/AskAgentModal";
export type { AgentModalAnchorPoint } from "./utils/studioHelpers";
export {
  buildPickerAgentPrompt,
  buildPickerAgentContextPreview,
} from "./components/editor/domEditingAgentPrompt";
export type { AgentPromptElementInfo } from "./components/editor/domEditingAgentPrompt";

// Hooks
export { useElementPicker } from "./hooks/useElementPicker";
export type { PickedElement } from "./hooks/useElementPicker";

// Utilities
export { resolveSourceFile, applyPatch } from "./utils/sourcePatcher";
export type { PatchOperation } from "./utils/sourcePatcher";
export { parseStyleString, mergeStyleIntoTag, findElementBlock } from "./utils/htmlEditor";
