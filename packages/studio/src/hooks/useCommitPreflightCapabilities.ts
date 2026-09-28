import { useEffect, useMemo, useRef, useState } from "react";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { preflightGsapDragIntercept, preflightGsapRotationIntercept } from "./gsapRuntimeBridge";
import { preflightGsapResizeIntercept } from "./gsapResizePreflight";
import { GSAP_EDIT_BLOCK_COPY, type GsapEditOutcome } from "./gsapEditOutcome";
import type { GsapAnimationFetchOptions } from "./useGsapAnimationFetchFallback";

interface CommitPreflight {
  offset: GsapEditOutcome;
  size: GsapEditOutcome;
  rotation: GsapEditOutcome;
}

async function runCommitPreflights(
  selection: DomEditSelection,
  animations: GsapAnimation[],
  iframe: HTMLIFrameElement | null,
): Promise<CommitPreflight> {
  return {
    offset: await preflightGsapDragIntercept(selection, animations, iframe),
    size: preflightGsapResizeIntercept(selection, animations, iframe),
    rotation: preflightGsapRotationIntercept(selection, animations, iframe),
  };
}

// A narrowed copy can be handed back as a new selection; narrowing always starts from the resolved one.
const resolvedSelections = new WeakMap<DomEditSelection, DomEditSelection>();

const resolvedOf = (selection: DomEditSelection) => resolvedSelections.get(selection) ?? selection;

const opensManualEdit = ({ capabilities: c }: DomEditSelection) =>
  c.canApplyManualOffset || c.canApplyManualSize || c.canApplyManualRotation;

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
  const narrowed = { ...resolved, capabilities: next };
  resolvedSelections.set(narrowed, resolved);
  return narrowed;
}

interface Verdict {
  version: number;
  preflight: CommitPreflight | null;
}

/**
 * The one place selection capabilities learn what the GSAP commit would refuse,
 * so chrome, nudge and group gates never offer an edit that snaps back.
 */
export function useCommitPreflightCapabilities({
  enabled,
  selection,
  groupSelections,
  previewIframeRef,
  makeFetchFallback,
  version,
}: {
  enabled: boolean;
  selection: DomEditSelection | null;
  groupSelections: DomEditSelection[];
  previewIframeRef: React.RefObject<HTMLIFrameElement | null>;
  makeFetchFallback: (
    selection: DomEditSelection,
    options?: GsapAnimationFetchOptions,
  ) => () => Promise<GsapAnimation[]>;
  version: number;
}) {
  const verdictsRef = useRef(new WeakMap<HTMLElement, Verdict>());
  const [verdictTick, setVerdictTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    for (const target of selection ? [selection, ...groupSelections] : groupSelections) {
      const known = verdictsRef.current.get(target.element);
      if (!opensManualEdit(resolvedOf(target)) || known?.version === version) continue;
      // Re-checking an element keeps its last verdict, so a commit does not blink its handles.
      verdictsRef.current.set(target.element, { version, preflight: known?.preflight ?? null });
      void makeFetchFallback(target, { failOnFetchError: true })()
        .then((animations) => runCommitPreflights(target, animations, previewIframeRef.current))
        .catch(() => null)
        .then((preflight) => {
          const current = verdictsRef.current.get(target.element);
          if (current?.version !== version) return;
          if (JSON.stringify(current.preflight) === JSON.stringify(preflight)) return;
          verdictsRef.current.set(target.element, { version, preflight });
          setVerdictTick((tick) => tick + 1);
        });
    }
  }, [enabled, selection, groupSelections, version, makeFetchFallback, previewIframeRef]);

  return useMemo(() => {
    void verdictTick;
    if (!enabled) return { selection, groupSelections };
    const narrow = (target: DomEditSelection) =>
      narrowCapabilities(target, verdictsRef.current.get(target.element)?.preflight ?? null);
    return {
      selection: selection && narrow(selection),
      groupSelections: groupSelections.map(narrow),
    };
  }, [enabled, selection, groupSelections, verdictTick]);
}
