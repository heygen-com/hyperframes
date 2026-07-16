export { createStudioApi } from "./createStudioApi.js";
export { createProjectSignature } from "./helpers/projectSignature.js";
export type {
  StudioApiAdapter,
  ResolvedProject,
  RenderJobState,
  MediaProcessingJobState,
  LintResult,
  StudioSelectionResponse,
  StudioSelectionSnapshot,
  StudioSelectionTextField,
} from "./types.js";
export { isSafePath, walkDir } from "./helpers/safePath.js";
export { getMimeType, MIME_TYPES } from "./helpers/mime.js";
export {
  consumeFileWriteReceipt,
  fileContentVersion,
  type FileWriteReceipt,
} from "./helpers/fileVersion.js";
export { buildSubCompositionHtml } from "./helpers/subComposition.js";
export { getElementScreenshotClip, type ScreenshotClip } from "./helpers/screenshotClip.js";
export {
  createBackgroundRemovalJob,
  type BackgroundRemovalRender,
} from "./helpers/backgroundRemovalJob.js";
export {
  STUDIO_MANUAL_EDITS_PATH,
  createStudioManualEditsRenderBodyScript,
  createStudioPositionSeekReapplyScript,
  type StudioManualEditsRenderScriptOptions,
} from "./helpers/manualEditsRenderScript.js";
export {
  STUDIO_MOTION_PATH,
  createStudioMotionRenderBodyScript,
  type StudioMotionRenderScriptOptions,
} from "./helpers/studioMotionRenderScript.js";
