import type { ParsedGsap } from "@hyperframes/core/gsap-parser";
import type { Composition } from "@hyperframes/sdk";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import type { EditHistoryKind } from "../utils/editHistory";

export interface MutationResult {
  ok: boolean;
  changed?: boolean;
  parsed?: ParsedGsap;
  before?: string;
  after?: string;
  scriptText?: string;
}

export interface CommitMutationOptions {
  label: string;
  coalesceKey?: string;
  softReload?: boolean;
  skipReload?: boolean;
  beforeReload?: () => void;
}

export type CommitMutation = (
  selection: DomEditSelection,
  mutation: Record<string, unknown>,
  options: CommitMutationOptions,
) => Promise<void>;

export type SafeGsapCommitMutation = (
  selection: DomEditSelection,
  mutation: Record<string, unknown>,
  options: CommitMutationOptions,
) => void;

export type TrackGsapSaveFailure = (
  error: unknown,
  selection: DomEditSelection,
  mutation: Record<string, unknown>,
  label?: string,
) => void;

export interface GsapScriptCommitsParams {
  projectIdRef: React.MutableRefObject<string | null>;
  activeCompPath: string | null;
  previewIframeRef: React.RefObject<HTMLIFrameElement | null>;
  editHistory: {
    recordEdit: (entry: {
      label: string;
      kind: EditHistoryKind;
      coalesceKey?: string;
      files: Record<string, { before: string; after: string }>;
    }) => Promise<void>;
  };
  domEditSaveTimestampRef: React.MutableRefObject<number>;
  reloadPreview: () => void;
  onCacheInvalidate: () => void;
  onFileContentChanged?: (path: string, content: string) => void;
  showToast: (message: string, tone?: "error" | "info") => void;
  /** Stage 7 Step 3b: SDK session for shadow GSAP dispatch (server stays authoritative). */
  sdkSession?: Composition | null;
}
