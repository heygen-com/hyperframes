import type { ParsedGsap } from "@hyperframes/core/gsap-parser";
import type { Composition } from "@hyperframes/sdk";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import type { EditHistoryKind } from "../utils/editHistory";
import type { ShadowGsapOp } from "../utils/sdkShadow";
import type { ShadowKeyframeOp } from "../utils/sdkShadowGsapKeyframe";

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
  /**
   * Serialize this commit against others sharing the same key. Used to chain
   * per-animationId GSAP meta updates so overlapping read-modify-write POSTs to
   * one file can't interleave — which would pair the shadow fidelity diff with a
   * stale server result and report false ease mismatches. Commits without a key
   * (and under distinct keys) run concurrently as before.
   */
  serializeKey?: string;
  /** Stage 7 Step 3b: typed SDK equivalent of this mutation for value-fidelity shadow. */
  shadowGsapOp?: ShadowGsapOp;
  /** Typed SDK equivalent of a keyframe mutation for keyframe value-fidelity shadow (gsap_keyframe). */
  shadowKeyframeOp?: ShadowKeyframeOp;
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
