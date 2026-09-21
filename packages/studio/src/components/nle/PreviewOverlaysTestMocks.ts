import { vi } from "vitest";

const previewState = vi.hoisted(() => ({ captionEditMode: false }));
export function getPreviewState() {
  return previewState;
}
export const iframeRef = { current: null as HTMLIFrameElement | null };

vi.mock("../../contexts/StudioContext", () => ({
  useStudioShellContext: () => ({ activeCompPath: "index.html", previewIframeRef: iframeRef }),
  useStudioPlaybackContext: () => ({
    captionEditMode: previewState.captionEditMode,
    compositionLoading: false,
    isPlaying: false,
  }),
}));
vi.mock("../../captions/store", () => {
  const state = {
    model: null,
    dismissed: false,
    syncError: null,
    clearSelection: vi.fn(),
    setDismissed: vi.fn(),
    setEditMode: vi.fn(),
    setSyncError: vi.fn(),
  };
  return {
    useCaptionStore: Object.assign(
      (selector: (value: typeof state) => unknown) => selector(state),
      { getState: () => state },
    ),
  };
});
vi.mock("../../hooks/useCompositionDimensions", () => ({
  useCompositionDimensions: () => null,
}));
vi.mock("../../utils/studioUiPreferences", () => ({ readStudioUiPreferences: () => ({}) }));
vi.mock("./useCanvasZOrderTimelineMirror", () => ({
  useCanvasZOrderTimelineMirror: () => vi.fn(),
}));
