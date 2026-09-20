// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreviewOverlays } from "./PreviewOverlays";
import { usePreviewBlockDrop } from "./usePreviewBlockDrop";
import { PreviewReadOnlyProvider } from "../editor/previewReadOnlyContext";
import { TIMELINE_BLOCK_MIME } from "../../utils/timelineAssetDrop";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const previewState = vi.hoisted(() => ({ captionEditMode: false }));
const iframeRef = { current: null as HTMLIFrameElement | null };

// fallow-ignore-next-line code-duplication
vi.mock("../../contexts/StudioContext", () => ({
  useStudioShellContext: () => ({ activeCompPath: "index.html", previewIframeRef: iframeRef }),
  useStudioPlaybackContext: () => ({
    captionEditMode: previewState.captionEditMode,
    compositionLoading: false,
    isPlaying: false,
  }),
}));
vi.mock("../../contexts/DomEditContext", () => ({
  useDomEditSelectionContext: () => ({
    domEditHoverSelection: null,
    domEditSelection: null,
    domEditGroupSelections: [],
  }),
  useDomEditActionsContext: () => ({}),
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
vi.mock("../editor/TopologyLens", () => ({ TopologyLens: () => null }));
vi.mock("../../captions/components/CaptionOverlay", () => ({
  CaptionOverlay: () => <i data-testid="caption-overlay" />,
}));
vi.mock("../editor/DomEditOverlay", () => ({
  DomEditOverlay: () => <i data-testid="dom-edit-overlay" />,
}));
vi.mock("../editor/MotionPathOverlay", () => ({
  MotionPathOverlay: () => <i data-testid="motion-path" />,
}));
vi.mock("../editor/SnapToolbar", () => ({ SnapToolbar: () => null }));

let root: Root;
let host: HTMLDivElement;

function mount(node: React.ReactNode, readOnly = false): void {
  host = document.createElement("div");
  iframeRef.current = document.createElement("iframe");
  document.body.append(host, iframeRef.current);
  root = createRoot(host);
  act(() =>
    root.render(<PreviewReadOnlyProvider readOnly={readOnly}>{node}</PreviewReadOnlyProvider>),
  );
}

afterEach(() => {
  act(() => root.unmount());
  previewState.captionEditMode = false;
  document.body.replaceChildren();
});

const overlays = () => (
  <PreviewOverlays shouldShowMotionPath={true} shouldShowSelectedDomBounds={true} />
);
const has = (id: string) => host.querySelector(`[data-testid="${id}"]`) !== null;

describe("PreviewOverlays with the preview read-only", () => {
  it("control: with the flag off the motion path can be edited", () => {
    mount(overlays());
    expect(has("motion-path")).toBe(true);
  });

  it("does not mount the motion path editor", () => {
    mount(overlays(), true);
    expect(has("motion-path")).toBe(false);
    expect(has("dom-edit-overlay")).toBe(true);
  });

  it("control: with the flag off caption mode mounts the caption editor", () => {
    previewState.captionEditMode = true;
    mount(overlays());
    expect(has("caption-overlay")).toBe(true);
  });

  it("does not mount the caption editor, and selection stays on the canvas overlay", () => {
    previewState.captionEditMode = true;
    mount(overlays(), true);
    expect(has("caption-overlay")).toBe(false);
    expect(has("dom-edit-overlay")).toBe(true);
  });
});

describe("usePreviewBlockDrop with the preview read-only", () => {
  function dropOnPreview(
    onBlockDrop: (name: string, pos: { left: number; top: number }) => void,
    readOnly = false,
  ) {
    const stage = document.createElement("div");
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect;
    let handlers: ReturnType<typeof usePreviewBlockDrop> | null = null;
    function Probe() {
      handlers = usePreviewBlockDrop({
        stageRef: { current: stage },
        compositionSize: { width: 1000, height: 1000 },
        onBlockDrop,
      });
      return null;
    }
    mount(<Probe />, readOnly);
    const event = {
      clientX: 50,
      clientY: 50,
      preventDefault: vi.fn(),
      dataTransfer: {
        types: [TIMELINE_BLOCK_MIME],
        getData: () => JSON.stringify({ name: "lower-third" }),
      },
    };
    act(() => handlers!.handleDrop(event as never));
    return event;
  }

  it("control: with the flag off a dropped block is placed", () => {
    const onBlockDrop = vi.fn();
    dropOnPreview(onBlockDrop);
    expect(onBlockDrop).toHaveBeenCalledWith("lower-third", { left: 500, top: 500 });
  });

  it("does not place a dropped block", () => {
    const onBlockDrop = vi.fn();
    const event = dropOnPreview(onBlockDrop, true);
    expect(onBlockDrop).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
