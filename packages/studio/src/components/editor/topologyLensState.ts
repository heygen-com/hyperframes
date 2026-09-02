import type {
  StudioEditLifecycleState,
  StudioWriteOperation,
  StudioWriteTarget,
} from "../../webmcp/writeCoordinator";

type TopologyLensBase = {
  callId: string;
  projectId: string;
  target: StudioWriteTarget;
  operation: StudioWriteOperation;
};

type ActiveLifecycle = Exclude<StudioEditLifecycleState, { phase: "idle" }>;

export type TopologyLensState =
  | { phase: "hidden" }
  | (TopologyLensBase & { phase: "acquiring"; pendingLifecycle: ActiveLifecycle | null })
  | (TopologyLensBase & {
      phase: "localizing";
      terminal: "dispatched" | "failed" | "no-change" | null;
    })
  | (TopologyLensBase & {
      phase: "sealing";
      receiptStage: "saved" | "verified";
    });

export type TopologyLensEvent =
  | { type: "lifecycle"; value: StudioEditLifecycleState }
  | { type: "acquisition-elapsed"; callId: string };

function visibleBase(value: ActiveLifecycle): TopologyLensBase {
  return {
    callId: value.callId,
    projectId: value.projectId,
    target: value.target,
    operation: value.operation,
  };
}

function presentLifecycle(lifecycle: ActiveLifecycle): TopologyLensState {
  const base = visibleBase(lifecycle);
  if (lifecycle.phase === "dispatching") {
    return lifecycle.targetChanged
      ? { ...base, phase: "acquiring", pendingLifecycle: null }
      : { ...base, phase: "localizing", terminal: null };
  }
  if (lifecycle.phase === "dispatched" || lifecycle.phase === "failed") {
    return { ...base, phase: "localizing", terminal: lifecycle.phase };
  }
  if (lifecycle.receipt?.ok && lifecycle.receipt.changed === false) {
    return { ...base, phase: "localizing", terminal: "no-change" };
  }
  return { ...base, phase: "sealing", receiptStage: lifecycle.phase };
}

/**
 * Presentation follows transaction facts. Elapsed events may finish a visual
 * transition, but cannot promote a receipt or invent persistence.
 */
export function reduceTopologyLens(
  state: TopologyLensState,
  event: TopologyLensEvent,
): TopologyLensState {
  if (event.type === "lifecycle") {
    const lifecycle = event.value;
    if (lifecycle.phase === "idle") return { phase: "hidden" };
    if (
      state.phase === "acquiring" &&
      lifecycle.callId === state.callId &&
      lifecycle.phase !== "dispatching"
    ) {
      return { ...state, pendingLifecycle: lifecycle };
    }
    return presentLifecycle(lifecycle);
  }

  if (state.phase === "hidden" || state.callId !== event.callId) return state;
  if (state.phase !== "acquiring") return state;
  return state.pendingLifecycle
    ? presentLifecycle(state.pendingLifecycle)
    : { ...state, phase: "localizing", terminal: null };
}
