import { create } from "zustand";

const DEFAULT_REASON = "Preview is read-only.";

interface PreviewReadOnlyState {
  readOnly: boolean;
  reason: string;
  setReadOnly: (readOnly: boolean, reason?: string) => void;
}

export const usePreviewReadOnlyStore = create<PreviewReadOnlyState>((set) => ({
  readOnly: false,
  reason: DEFAULT_REASON,
  setReadOnly: (readOnly, reason) => set({ readOnly, reason: reason ?? DEFAULT_REASON }),
}));

export const usePreviewReadOnly = () => usePreviewReadOnlyStore((s) => s.readOnly);

/** Short host-supplied text for why a hand-edit control is disabled. */
export const usePreviewReadOnlyReason = () => usePreviewReadOnlyStore((s) => s.reason);

/** For handlers that run outside React render. */
export const isPreviewReadOnly = () => usePreviewReadOnlyStore.getState().readOnly;

interface ManualEditCapabilities {
  canApplyManualOffset: boolean;
  canApplyManualSize: boolean;
  canApplyManualRotation: boolean;
}

/**
 * The manual X/Y/W/H/rotation fields' disabled state: capability, or preview read-only.
 * Call unconditionally, even with no selection — `capabilities` may be null/undefined.
 */
export function useManualEditDisabledFlags(
  capabilities: ManualEditCapabilities | null | undefined,
) {
  const readOnly = usePreviewReadOnly();
  return {
    manualOffsetEditingDisabled: !capabilities?.canApplyManualOffset || readOnly,
    manualSizeEditingDisabled: !capabilities?.canApplyManualSize || readOnly,
    manualRotationEditingDisabled: !capabilities?.canApplyManualRotation || readOnly,
  };
}
