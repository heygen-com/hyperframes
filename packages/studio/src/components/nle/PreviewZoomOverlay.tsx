import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  DEFAULT_PREVIEW_ZOOM,
  isFitZoom,
  isPreviewAtFit,
  parsePreviewZoomInput,
  resolvePreviewPixelGrid,
  resolvePreviewTypedZoom,
  resolvePreviewVisibleRegion,
  toDomPrecision,
  type PreviewZoomState,
} from "./previewZoom";

const NAVIGATOR_PX = 112;

function zoomChipLabel(zoomPercent: number): string {
  return isFitZoom(zoomPercent) ? "Panned" : `Zoomed ${Math.round(zoomPercent)}%`;
}

function navigatorFrameSize(stage: { width: number; height: number }) {
  const ratio = stage.width > 0 && stage.height > 0 ? stage.width / stage.height : 16 / 9;
  return ratio >= 1
    ? { width: NAVIGATOR_PX, height: toDomPrecision(NAVIGATOR_PX / ratio) }
    : { width: toDomPrecision(NAVIGATOR_PX * ratio), height: NAVIGATOR_PX };
}

/** `draw` moves the navigator's highlight without a render, so it can follow every transform write. */
function usePreviewNavigator(
  viewportRef: RefObject<HTMLDivElement | null>,
  stageSize: { width: number; height: number },
  zoomRef: RefObject<PreviewZoomState>,
) {
  const regionRef = useRef<HTMLDivElement | null>(null);
  const stageSizeRef = useRef(stageSize);
  stageSizeRef.current = stageSize;
  const draw = useCallback(
    (state: PreviewZoomState) => {
      const region = regionRef.current;
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!region || !rect) return;
      const visible = resolvePreviewVisibleRegion({
        state,
        viewportWidth: rect.width,
        viewportHeight: rect.height,
        contentWidth: stageSizeRef.current.width,
        contentHeight: stageSizeRef.current.height,
      });
      region.style.left = `${visible.left * 100}%`;
      region.style.top = `${visible.top * 100}%`;
      region.style.width = `${visible.width * 100}%`;
      region.style.height = `${visible.height * 100}%`;
    },
    [viewportRef],
  );
  const setRegion = useCallback(
    (node: HTMLDivElement | null) => {
      regionRef.current = node;
      draw(zoomRef.current);
    },
    [draw, zoomRef],
  );
  useEffect(() => draw(zoomRef.current), [stageSize, draw, zoomRef]);
  return { draw, setRegion };
}

function ZoomPercentInput({
  zoomPercent,
  onSubmit,
  onDone,
}: {
  zoomPercent: number;
  onSubmit: (zoomPercent: number) => void;
  onDone: () => void;
}) {
  const [text, setText] = useState(() => String(Math.round(zoomPercent)));
  return (
    <input
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      value={text}
      onChange={(event) => setText(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          const next = parsePreviewZoomInput(text);
          if (next !== null) onSubmit(next);
          onDone();
        } else if (event.key === "Escape") {
          onDone();
        }
      }}
      onBlur={onDone}
      inputMode="decimal"
      aria-label="Zoom percentage"
      className="w-12 rounded bg-white/10 px-1 py-0.5 text-xs tabular-nums text-white outline-hidden focus:ring-1 focus:ring-studio-accent"
      data-testid="preview-zoom-input"
    />
  );
}

function usePreviewPixelGrid(
  viewportRef: RefObject<HTMLDivElement | null>,
  stageSize: { width: number; height: number },
  compositionWidth: number | undefined,
  zoomRef: RefObject<PreviewZoomState>,
) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const layoutRef = useRef({ stageSize, compositionWidth });
  layoutRef.current = { stageSize, compositionWidth };
  const draw = useCallback(
    (state: PreviewZoomState) => {
      const grid = gridRef.current;
      if (!grid) return;
      const rect = viewportRef.current?.getBoundingClientRect();
      const { stageSize: stage, compositionWidth: width } = layoutRef.current;
      const box = rect && width ? resolvePreviewPixelGrid({ state, rect, stage, width }) : null;
      grid.hidden = !box;
      if (!box) return;
      grid.style.left = `${box.left}px`;
      grid.style.top = `${box.top}px`;
      grid.style.width = `${box.width}px`;
      grid.style.height = `${box.height}px`;
      grid.style.backgroundSize = `${box.cellPx}px ${box.cellPx}px`;
    },
    [viewportRef],
  );
  const setGrid = useCallback(
    (node: HTMLDivElement | null) => {
      gridRef.current = node;
      draw(zoomRef.current);
    },
    [draw, zoomRef],
  );
  useEffect(() => draw(zoomRef.current), [stageSize, compositionWidth, draw, zoomRef]);
  return { draw, setGrid };
}

export type PreviewZoomOverlayControls = ReturnType<typeof usePreviewZoomOverlay>;

export function usePreviewZoomOverlay(
  viewportRef: RefObject<HTMLDivElement | null>,
  stageSize: { width: number; height: number },
  zoomRef: RefObject<PreviewZoomState>,
  compositionWidth: number | undefined,
) {
  const { draw: drawNavigator, setRegion } = usePreviewNavigator(viewportRef, stageSize, zoomRef);
  const { draw: drawGrid, setGrid } = usePreviewPixelGrid(
    viewportRef,
    stageSize,
    compositionWidth,
    zoomRef,
  );
  const draw = useCallback(
    (state: PreviewZoomState) => {
      drawNavigator(state);
      drawGrid(state);
    },
    [drawNavigator, drawGrid],
  );
  return { viewportRef, draw, setRegion, setGrid };
}

export function PreviewZoomOverlay({
  zoom,
  stageSize,
  onZoom,
  controls,
}: {
  zoom: PreviewZoomState;
  stageSize: { width: number; height: number };
  onZoom: (next: PreviewZoomState) => void;
  controls: PreviewZoomOverlayControls;
}) {
  const [editing, setEditing] = useState(false);
  if (isPreviewAtFit(zoom)) return null;
  const { viewportRef } = controls;
  const zoomTo = (zoomPercent: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    onZoom(
      resolvePreviewTypedZoom({
        state: zoom,
        zoomPercent,
        viewportWidth: rect?.width ?? stageSize.width,
        viewportHeight: rect?.height ?? stageSize.height,
        contentWidth: stageSize.width,
        contentHeight: stageSize.height,
      }),
    );
    viewportRef.current?.focus();
  };
  return (
    <>
      <div
        ref={controls.setGrid}
        hidden
        aria-hidden="true"
        className="pointer-events-none absolute z-10"
        style={{
          backgroundImage:
            "linear-gradient(to right, var(--color-pixel-grid) 1px, transparent 1px), linear-gradient(to bottom, var(--color-pixel-grid) 1px, transparent 1px)",
        }}
        data-testid="preview-pixel-grid"
      />
      <div
        className="absolute top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 rounded-md py-1 pl-2.5 pr-1 text-xs text-white/80 bg-black/60 backdrop-blur-xs"
        data-testid="preview-zoom-chip"
        // The pane clears the timeline selection on a pointerdown outside the frame.
        onPointerDown={(event) => event.stopPropagation()}
      >
        {editing ? (
          <ZoomPercentInput
            zoomPercent={zoom.zoomPercent}
            onSubmit={zoomTo}
            onDone={() => setEditing(false)}
          />
        ) : (
          <button
            type="button"
            className="rounded px-1 py-0.5 tabular-nums hover:bg-white/10 transition-colors"
            onClick={() => setEditing(true)}
            aria-label="Type a zoom percentage"
            data-testid="preview-zoom-readout"
          >
            {zoomChipLabel(zoom.zoomPercent)}
          </button>
        )}
        <span aria-hidden="true" className="text-white/30">
          ·
        </span>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 font-medium text-accent-ink hover:bg-white/10 transition-colors"
          onClick={() => {
            onZoom(DEFAULT_PREVIEW_ZOOM);
            viewportRef.current?.focus();
          }}
          aria-label="Fit the whole frame in view"
          data-testid="preview-zoom-fit"
        >
          Fit
        </button>
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-3 right-3 z-50 rounded-md p-1.5 bg-black/60 backdrop-blur-xs"
        data-testid="preview-zoom-navigator"
      >
        <div className="relative overflow-hidden bg-white/10" style={navigatorFrameSize(stageSize)}>
          <div
            ref={controls.setRegion}
            className="absolute rounded-[1px] border border-studio-accent bg-studio-accent/15"
            data-testid="preview-zoom-navigator-region"
          />
        </div>
      </div>
    </>
  );
}
