// UI primitives
export { Button, buttonBase, buttonSizes, buttonVariants } from "./components/ui/Button";
export type { ButtonSize, ButtonVariant, PreviewState } from "./components/ui/Button";
export { HyperframesLogo } from "./components/StudioHeader";
export { IconButton } from "./components/ui/IconButton";
export { Tab, TabPanel, Tabs, TabsList } from "./components/ui/Tabs";
export { HyperframesLoader } from "./components/ui/HyperframesLoader";
export type { HyperframesLoaderProps } from "./components/ui/HyperframesLoader";
export { Tooltip } from "./components/ui/Tooltip";
export { cn } from "./components/ui/cn";
export {
  ContextMenu,
  Menu,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuShortcut,
  popupSurface,
} from "./components/ui/Menu";
export type { MenuItemTone, PopupPreviewState } from "./components/ui/Menu";
export { Popover } from "./components/ui/Popover";
export { Input, fieldBase, fieldText } from "./components/ui/Input";
export type { InputProps } from "./components/ui/Input";
export { NumberField } from "./components/ui/NumberField";
export type { NumberFieldProps } from "./components/ui/NumberField";
export { Select } from "./components/ui/Select";
export type { SelectOption, SelectProps } from "./components/ui/Select";
export { Slider } from "./components/ui/Slider";
export type { SliderProps } from "./components/ui/Slider";
export { Toggle } from "./components/ui/Toggle";
export type { ToggleProps } from "./components/ui/Toggle";

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
export type { TimelineElement, TimelineTimeRange } from "./player";

// Host overlays: draw over the preview in composition coordinates (see EditorShellProps.gestureOverlay)
export { usePreviewCompositionRect } from "./components/editor/usePreviewCompositionRect";
export type { PreviewCompositionRect } from "./components/editor/usePreviewCompositionRect";
export {
  PreviewOverlayProvider,
  usePreviewOverlayContext,
} from "./components/editor/PreviewOverlayProvider";
export type {
  PreviewOverlayProviderProps,
  PreviewSnapPreferences,
} from "./components/editor/PreviewOverlayProvider";
export { PreviewGuides } from "./components/editor/PreviewGuides";
export { GridOverlay } from "./components/editor/GridOverlay";
export { SnapToolbar } from "./components/editor/SnapToolbar";
export { usePreviewGuidesStore } from "./components/editor/previewGuidesStore";

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

// Render queue
export { RenderQueue } from "./components/renders/RenderQueue";
export type { RenderQueueProps, CompositionDimensions } from "./components/renders/RenderQueue";
export { useRenderQueue } from "./components/renders/useRenderQueue";
export type { FfmpegStatus } from "./components/renders/useFfmpegStatus";
export type {
  RenderJob,
  ResolutionPreset,
  StartRenderOptions,
} from "./components/renders/useRenderQueue";
export {
  getPersistedRenderSettings,
  persistRenderSettings,
} from "./components/renders/renderSettings";
export type { PersistedRenderSettings } from "./components/renders/renderSettings";

// Hooks
export { useElementPicker } from "./hooks/useElementPicker";
export type { PickedElement } from "./hooks/useElementPicker";

// Utilities
export { resolveSourceFile, applyPatch } from "./utils/sourcePatcher";
export type { PatchOperation } from "./utils/sourcePatcher";
export { parseStyleString, mergeStyleIntoTag, findElementBlock } from "./utils/htmlEditor";

// Timeline editing: Studio's own hand-edit path, undo/redo, the
// etag-guarded writer and the conflict banner, for a host mounting the
// timeline outside EditorShell.
export { usePersistentEditHistory } from "./hooks/usePersistentEditHistory";
export type { UsePersistentEditHistoryOptions } from "./hooks/usePersistentEditHistory";
export { useTimelineEditing } from "./hooks/useTimelineEditing";
export type { UseTimelineEditingOptions } from "./hooks/useTimelineEditingTypes";
// A host's own waitForPendingDomEditSaves must also call this, or undo/redo
// can race a write still in flight (see useTrackPendingTimelineEdit.ts).
export { flushStudioPendingEdits } from "./utils/studioPendingEdits";
export type { StudioPendingEditsDrainResult } from "./utils/studioPendingEdits";
export type {
  CanEditTimelineElement,
  TimelineEditPermission,
} from "./hooks/timelineEditPermission";
export { useEditHistoryActions } from "./hooks/useEditHistoryActions";
export type {
  EditHistoryHandle,
  UseEditHistoryActionsOptions,
} from "./hooks/useEditHistoryActions";
export { useProjectFileWriter } from "./hooks/useProjectFileWriter";
export type { UseProjectFileWriterOptions } from "./hooks/useProjectFileWriter";
// A host's writeProjectFile throws this on a 409; catch it to know when
// to show ExternalFileConflictBanner.
export { StudioFileConflictError } from "./utils/studioSaveDiagnostics";
export { ExternalFileConflictBanner } from "./components/ExternalFileConflictBanner";
export type {
  ExternalFileChangeCoordinatorHandle,
  ExternalFileChangeBlockedState,
} from "./hooks/useExternalFileChangeCoordinator";
export { TimelinePane } from "./components/nle/TimelinePane";
export type { TimelinePaneProps } from "./components/nle/TimelinePane";
export { TimelineEditProvider } from "./contexts/TimelineEditContext";
export type { TimelineEditCallbacks } from "./player/components/timelineCallbacks";
export type { BlockedTimelineEditIntent } from "./player/components/timelineEditing";
