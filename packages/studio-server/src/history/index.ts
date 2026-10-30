export {
  DEFAULT_HISTORY_ROOT,
  openProjectHistory,
  readProjectHistory,
  MAX_WINDOW_IDLE_MS,
  UNDO_MODES,
  type UndoMode,
  type ClosedWindow,
  type ProjectHistory,
  type ProjectHistoryOptions,
  type ProjectHistoryView,
  type HistoryListItem,
  type HistoryResult,
  type HistoryWindow,
  HistoryClosedError,
  HistoryRefusedError,
} from "./projectHistory.js";
export { reclaimUncopiedBlobs, type ReclaimedHistory } from "./reclaimUncopied.js";
export { HistoryBusyError } from "./ownerLock.js";
export { onRestoredInPlace, type InPlaceOutcome } from "./blobStore.js";
export { HistoryIdError } from "./historyId.js";
export { historyCache } from "./historyCache.js";
export {
  listProjectHistories,
  pruneGoneProjectHistories,
  type ProjectHistoryRecord,
  type PrunedHistory,
} from "./pruneHistories.js";
export {
  START as HISTORY_START,
  type HistoryEntry,
  type HistoryTarget,
  type HistoryEntrySide,
  type HistoryFileChange,
  type HistoryWho,
} from "./historyLog.js";

export {
  beginArtifactCapture,
  forgetRecordedArtifacts,
  recordArtifact,
  recordArtifacts,
  artifactDirectory,
  finishSnapshotRun,
  type ArtifactCapture,
  type ArtifactInput,
  type ArtifactRecord,
  type VideoState,
  recordRenderSuccess,
  type RenderRecord,
} from "./videoState.js";

export { registerRenderOutput } from "../helpers/renderOutputs.js";

export { retainSnapshotOutput } from "./snapshotRuns.js";
