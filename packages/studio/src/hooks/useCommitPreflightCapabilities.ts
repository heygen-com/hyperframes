import { useEffect, useMemo, useRef, useState } from "react";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { dragEditOutcome, preflightGsapRotationIntercept } from "./gsapRuntimeBridge";
import { preflightGsapResizeIntercept } from "./gsapResizePreflight";
import { GSAP_EDIT_BLOCK_COPY, type GsapEditOutcome } from "./gsapEditOutcome";
import { fetchParsedAnimations } from "./keyframeCacheAstLoad";
import {
  gsapSourceFileForSelection,
  selectElementAnimationsOrRetry,
} from "./useGsapAnimationFetchFallback";

interface CommitPreflight {
  offset: GsapEditOutcome;
  size: GsapEditOutcome;
  rotation: GsapEditOutcome;
}

function runCommitPreflights(
  selection: DomEditSelection,
  fileAnimations: GsapAnimation[],
  iframe: HTMLIFrameElement | null,
): CommitPreflight {
  const target = { id: selection.id ?? null, selector: selection.selector ?? null };
  const matched = selectElementAnimationsOrRetry(
    { animations: fileAnimations },
    target,
    selection.element,
  );
  // A file the server parsed with no tweens at all is a definitive answer here.
  const animations = matched.kind === "resolved" ? matched.animations : [];
  return {
    offset: dragEditOutcome(selection, animations, iframe),
    size: preflightGsapResizeIntercept(selection, animations, iframe),
    rotation: preflightGsapRotationIntercept(selection, animations, iframe),
  };
}

// Studio can hand a narrowed copy back as a new selection; narrowing starts from the resolved one.
const resolvedSelections = new WeakMap<DomEditSelection, DomEditSelection>();

const resolvedOf = (selection: DomEditSelection) => resolvedSelections.get(selection) ?? selection;

const MANUAL_FLAGS = [
  ["canApplyManualOffset", "offset"],
  ["canApplyManualSize", "size"],
  ["canApplyManualRotation", "rotation"],
] as const;

/** Null when the commit would go through; "" while the check is still running. */
function refusal(preflight: CommitPreflight | null, check: keyof CommitPreflight): string | null {
  const outcome = preflight?.[check];
  if (outcome?.status === "persisted") return null;
  return outcome ? GSAP_EDIT_BLOCK_COPY[outcome.reason] : "";
}

/** Closes each manual flag whose commit Studio would refuse, and says why. */
function narrowCapabilities(
  selection: DomEditSelection,
  preflight: CommitPreflight | null,
): DomEditSelection {
  const resolved = resolvedOf(selection);
  const next = { ...resolved.capabilities };
  const reasons: string[] = [];
  for (const [flag, check] of MANUAL_FLAGS) {
    const reason = refusal(preflight, check);
    if (!next[flag] || reason === null) continue;
    next[flag] = false;
    reasons.push(reason);
  }
  if (reasons.length === 0) return resolved;
  next.reasonIfDisabled = reasons.find(Boolean) || next.reasonIfDisabled;
  if (!preflight) next.commitCheckPending = true;
  const narrowed = { ...resolved, capabilities: next };
  resolvedSelections.set(narrowed, resolved);
  return narrowed;
}

interface FileParse {
  version: number;
  animations: GsapAnimation[] | null;
}

/**
 * The one place selection capabilities learn what the GSAP commit would refuse,
 * so chrome, nudge and group gates never offer an edit that snaps back.
 */
export function useCommitPreflightCapabilities({
  projectId,
  enabled,
  selection,
  groupSelections,
  previewIframeRef,
  version,
}: {
  projectId: string | null;
  enabled: boolean;
  selection: DomEditSelection | null;
  groupSelections: DomEditSelection[];
  previewIframeRef: React.RefObject<HTMLIFrameElement | null>;
  version: number;
}) {
  // One parse per file and version; the last good parse answers while a newer one loads.
  const parsesRef = useRef(new Map<string, FileParse>());
  const [parseTick, setParseTick] = useState(0);
  const active = enabled && projectId !== null;

  useEffect(() => {
    if (!enabled || !projectId) return;
    const targets = selection ? [selection, ...groupSelections] : groupSelections;
    for (const file of new Set(targets.map(gsapSourceFileForSelection))) {
      const known = parsesRef.current.get(file);
      if (known?.version === version) continue;
      parsesRef.current.set(file, { version, animations: known?.animations ?? null });
      void fetchParsedAnimations(projectId, file).then((parsed) => {
        const current = parsesRef.current.get(file);
        if (current?.version !== version) return;
        // A failed read is not an answer: forget it so the next selection asks again.
        if (parsed) parsesRef.current.set(file, { version, animations: parsed.animations });
        else parsesRef.current.delete(file);
        // Re-render only when an answer changed, so a read that keeps failing cannot loop.
        if (parsed || current.animations) setParseTick((tick) => tick + 1);
      });
    }
  }, [enabled, projectId, selection, groupSelections, version]);

  return useMemo(() => {
    void parseTick;
    if (!active) return { selection, groupSelections };
    const narrow = (target: DomEditSelection) => {
      const animations = parsesRef.current.get(gsapSourceFileForSelection(target))?.animations;
      const preflight = animations
        ? runCommitPreflights(resolvedOf(target), animations, previewIframeRef.current)
        : null;
      return narrowCapabilities(target, preflight);
    };
    return {
      selection: selection && narrow(selection),
      groupSelections: groupSelections.map(narrow),
    };
  }, [active, selection, groupSelections, parseTick, previewIframeRef]);
}
