import type { MutableRefObject, RefObject } from "react";
import type { Composition } from "@hyperframes/sdk";
import type { TimelineElement } from "../player";
import type { EditHistoryKind } from "../utils/editHistory";

interface RecordEditInput {
  label: string;
  kind: EditHistoryKind;
  coalesceKey?: string;
  files: Record<string, { before: string; after: string }>;
}

export interface UseTimelineEditingOptions {
  projectId: string | null;
  activeCompPath: string | null;
  timelineElements: TimelineElement[];
  showToast: (message: string, tone?: "error" | "info") => void;
  writeProjectFile: (path: string, content: string) => Promise<void>;
  recordEdit: (input: RecordEditInput) => Promise<void>;
  domEditSaveTimestampRef: MutableRefObject<number>;
  reloadPreview: () => void;
  previewIframeRef: RefObject<HTMLIFrameElement | null>;
  pendingTimelineEditPathRef: MutableRefObject<Set<string>>;
  uploadProjectFiles: (files: Iterable<File>, dir?: string) => Promise<string[]>;
  isRecordingRef?: RefObject<boolean>;
  /** Stage 7 §3.2: SDK session for routing timing ops through setTiming. */
  sdkSession?: Composition | null;
  /** Resync the SDK session after a server-authoritative timeline write. */
  forceReloadSdkSession?: () => void;
}
