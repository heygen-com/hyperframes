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

// Resolves once the z-index patches are persisted, so a caller that also writes
// the same file (e.g. a timing move) can order its write after this one.
export type TimelineZIndexReorderCommit = (
  entries: Array<{
    element: HTMLElement;
    zIndex: number;
    id?: string;
    selector?: string;
    selectorIndex?: number;
    sourceFile: string;
    key?: string;
  }>,
  coalesceKey?: string,
) => Promise<void>;

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
  handleDomZIndexReorderCommitRef?: MutableRefObject<TimelineZIndexReorderCommit | null>;
}

export type TimelineFileDropHandler = (
  files: File[],
  placement?: { start: number; track: number },
) => Promise<void>;
