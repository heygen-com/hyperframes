import { memo, useState, useCallback, useRef } from "react";
import { useCaptionStore } from "../store";
import { useMountEffect } from "../../hooks/useMountEffect";
import { shouldHandleCaptionNudgeKey } from "../keyboard";
import {
  readWordBoxes,
  getWordEl,
  readGsapTransform,
  getOrCreateWrapper,
  writeTransform,
  computeTransformStyle,
  type WordBox,
} from "./CaptionOverlayUtils";

interface CaptionOverlayProps {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
}

const HANDLE = 8;
const ROTATION_OFFSET = 20; // px above the selection box

/** Sync canvas state back to the Zustand store so the property panel reflects it. */
function syncToStore(segmentId: string, el: HTMLElement, iframeWin: Window) {
  const style = computeTransformStyle(el, iframeWin);
  if (Object.keys(style).length > 0) {
    useCaptionStore.getState().updateSegmentStyle(segmentId, style);
  }
}

export const CaptionOverlay = memo(function CaptionOverlay({ iframeRef }: CaptionOverlayProps) {
  const isEditMode = useCaptionStore((s) => s.isEditMode);
  const model = useCaptionStore((s) => s.model);
  const selectedSegmentIds = useCaptionStore((s) => s.selectedSegmentIds);
  const selectSegment = useCaptionStore((s) => s.selectSegment);
  const clearSelection = useCaptionStore((s) => s.clearSelection);

  const [wordBoxes, setWordBoxes] = useState<WordBox[]>([]);
  const overlayRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef(model);
  modelRef.current = model;

  // Interaction mode — only one active at a time
  const interactionRef = useRef<
    | {
        type: "move";
        wordEl: HTMLElement;
        segmentId: string;
        startMX: number;
        startMY: number;
        origTX: number;
        origTY: number;
        origScale: number;
        origRotation: number;
      }
    | {
        type: "scale";
        wordEl: HTMLElement;
        segmentId: string;
        startMX: number;
        startDxFromCenter: number;
        origTX: number;
        origTY: number;
        origScale: number;
        origRotation: number;
      }
    | {
        type: "rotate";
        wordEl: HTMLElement;
        segmentId: string;
        startMX: number;
        origTX: number;
        origTY: number;
        origRotation: number;
        origScale: number;
      }
    | null
  >(null);

  useMountEffect(() => {
    if (!isEditMode) return;
    let prevBoxes: WordBox[] = [];
    const tick = () => {
      const iframe = iframeRef.current;
      const m = modelRef.current;
      const overlay = overlayRef.current;
      if (!iframe || !m || !overlay) return;
      const next = readWordBoxes(iframe, m, overlay);
      if (
        next.length === prevBoxes.length &&
        next.every(
          (b, i) => Math.abs(b.x - prevBoxes[i].x) < 0.5 && Math.abs(b.y - prevBoxes[i].y) < 0.5,
        )
      )
        return;
      prevBoxes = next;
      setWordBoxes(next);
    };
    const id = setInterval(tick, 66);
    tick();

    // Arrow key nudge for selected words
    const handleKeyDown = (e: KeyboardEvent) => {
      const { selectedSegmentIds: sel, model: m } = useCaptionStore.getState();
      if (sel.size === 0 || !m) return;
      const arrow = e.key;
      if (!shouldHandleCaptionNudgeKey(e)) return;

      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = arrow === "ArrowLeft" ? -step : arrow === "ArrowRight" ? step : 0;
      const dy = arrow === "ArrowUp" ? -step : arrow === "ArrowDown" ? step : 0;

      const iframe = iframeRef.current;
      const win = iframe?.contentWindow;
      if (!iframe || !win) return;

      for (const segId of sel) {
        for (let gi = 0; gi < m.groupOrder.length; gi++) {
          const group = m.groups.get(m.groupOrder[gi]);
          if (!group) continue;
          const wi = group.segmentIds.indexOf(segId);
          if (wi < 0) continue;
          const wordEl = getWordEl(iframe, gi, wi);
          if (!wordEl) continue;
          const wrapper = getOrCreateWrapper(wordEl);
          const state = readGsapTransform(wrapper, win);
          writeTransform(wordEl, win, state.x + dx, state.y + dy, state.scale, state.rotation);
          syncToStore(segId, wordEl, win);
          break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      clearInterval(id);
      window.removeEventListener("keydown", handleKeyDown);
    };
  });

  const getCssScale = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return 1;
    const rect = iframe.getBoundingClientRect();
    const nativeW = parseFloat(iframe.style.width) || rect.width;
    return rect.width / nativeW;
  }, [iframeRef]);

  // --- Move ---
  const startMove = useCallback(
    (groupIndex: number, wordIndex: number, segmentId: string, e: React.PointerEvent) => {
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const iframe = iframeRef.current;
      if (!iframe) return;
      const wordEl = getWordEl(iframe, groupIndex, wordIndex);
      const win = iframe.contentWindow;
      if (!wordEl || !win) return;
      const state = readGsapTransform(getOrCreateWrapper(wordEl), win);
      interactionRef.current = {
        type: "move",
        wordEl,
        segmentId,
        startMX: e.clientX,
        startMY: e.clientY,
        origTX: state.x,
        origTY: state.y,
        origScale: state.scale,
        origRotation: state.rotation,
      };
    },
    [iframeRef],
  );

  // --- Scale ---
  const startScale = useCallback(
    (groupIndex: number, wordIndex: number, segmentId: string, e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const iframe = iframeRef.current;
      if (!iframe) return;
      const wordEl = getWordEl(iframe, groupIndex, wordIndex);
      const win = iframe.contentWindow;
      if (!wordEl || !win) return;
      const rect = wordEl.getBoundingClientRect();
      const cssScale = getCssScale();
      const boxCenterX =
        rect.left * cssScale +
        (iframeRef.current?.getBoundingClientRect().left ?? 0) +
        (rect.width * cssScale) / 2;
      const state = readGsapTransform(getOrCreateWrapper(wordEl), win);
      interactionRef.current = {
        type: "scale",
        wordEl,
        segmentId,
        startMX: e.clientX,
        startDxFromCenter: e.clientX - boxCenterX,
        origTX: state.x,
        origTY: state.y,
        origScale: state.scale,
        origRotation: state.rotation,
      };
    },
    [iframeRef, getCssScale],
  );

  // --- Rotate ---
  const startRotate = useCallback(
    (box: WordBox, e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const iframe = iframeRef.current;
      if (!iframe) return;
      const wordEl = getWordEl(iframe, box.groupIndex, box.wordIndex);
      const win = iframe.contentWindow;
      if (!wordEl || !win) return;
      const state = readGsapTransform(getOrCreateWrapper(wordEl), win);
      interactionRef.current = {
        type: "rotate",
        wordEl,
        segmentId: box.segmentId,
        startMX: e.clientX,
        origTX: state.x,
        origTY: state.y,
        origRotation: state.rotation,
        origScale: state.scale,
      };
    },
    [iframeRef],
  );

  const getIframeWin = useCallback((): Window | null => {
    try {
      return iframeRef.current?.contentWindow ?? null;
    } catch {
      return null;
    }
  }, [iframeRef]);

  // --- Unified pointer move ---
  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const i = interactionRef.current;
      if (!i) return;
      const win = getIframeWin();
      if (!win) return;

      if (i.type === "move") {
        const cssScale = getCssScale();
        const dx = (e.clientX - i.startMX) / cssScale;
        const dy = (e.clientY - i.startMY) / cssScale;
        writeTransform(i.wordEl, win, i.origTX + dx, i.origTY + dy, i.origScale, i.origRotation);
      } else if (i.type === "scale") {
        const cx = i.startMX - i.startDxFromCenter;
        const startDist = Math.abs(i.startDxFromCenter);
        const currentDist = Math.abs(e.clientX - cx);
        const factor = startDist > 5 ? currentDist / startDist : 1;
        const newScale = Math.max(0.1, i.origScale * factor);
        writeTransform(i.wordEl, win, i.origTX, i.origTY, newScale, i.origRotation);
      } else if (i.type === "rotate") {
        const dx = e.clientX - i.startMX;
        const delta = (dx / 200) * 90;
        writeTransform(i.wordEl, win, i.origTX, i.origTY, i.origScale, i.origRotation + delta);
      }
    },
    [getCssScale, getIframeWin],
  );

  // --- Unified pointer up — sync back to store ---
  const handlePointerUp = useCallback(() => {
    const i = interactionRef.current;
    if (i) {
      const win = getIframeWin();
      if (win) syncToStore(i.segmentId, i.wordEl, win);
      interactionRef.current = null;
    }
  }, [getIframeWin]);

  const handleBackgroundClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) clearSelection();
    },
    [clearSelection],
  );

  if (!isEditMode) return null;

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 z-50"
      style={{ pointerEvents: "auto" }}
      onClick={handleBackgroundClick}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onLostPointerCapture={handlePointerUp}
    >
      {wordBoxes.map((box) => {
        const isSelected = selectedSegmentIds.has(box.segmentId);
        return (
          <div
            key={box.segmentId}
            className={[
              "absolute",
              isSelected ? "ring-2 ring-studio-accent" : "hover:ring-1 hover:ring-white/30",
            ].join(" ")}
            style={{
              left: box.x,
              top: box.y,
              width: box.width,
              height: box.height,
              cursor: isSelected ? "move" : "pointer",
              touchAction: "none",
              borderRadius: 2,
            }}
            onClick={(e) => {
              e.stopPropagation();
              selectSegment(box.segmentId, e.shiftKey);
            }}
            onPointerDown={(e) => {
              if (isSelected) startMove(box.groupIndex, box.wordIndex, box.segmentId, e);
            }}
          >
            {isSelected && (
              <>
                {/* Rotation handle — circle above the box */}
                <div
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: -ROTATION_OFFSET - HANDLE,
                    marginLeft: -HANDLE / 2,
                    width: HANDLE,
                    height: HANDLE,
                    borderRadius: "50%",
                    backgroundColor: "var(--hf-accent, #3CE6AC)",
                    border: "1px solid rgba(0,0,0,0.5)",
                    cursor: "grab",
                    touchAction: "none",
                  }}
                  onPointerDown={(e) => startRotate(box, e)}
                />
                {/* Line from box to rotation handle */}
                <div
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: -ROTATION_OFFSET,
                    width: 1,
                    height: ROTATION_OFFSET,
                    marginLeft: -0.5,
                    backgroundColor: "var(--hf-accent, #3CE6AC)",
                    opacity: 0.5,
                    pointerEvents: "none",
                  }}
                />
                {/* Scale handles — four corners */}
                {[
                  { right: -HANDLE / 2, bottom: -HANDLE / 2, cursor: "nwse-resize" },
                  { left: -HANDLE / 2, top: -HANDLE / 2, cursor: "nwse-resize" },
                  { right: -HANDLE / 2, top: -HANDLE / 2, cursor: "nesw-resize" },
                  { left: -HANDLE / 2, bottom: -HANDLE / 2, cursor: "nesw-resize" },
                ].map((pos, idx) => (
                  <div
                    key={idx}
                    style={{
                      position: "absolute",
                      ...pos,
                      width: HANDLE,
                      height: HANDLE,
                      backgroundColor: "var(--hf-accent, #3CE6AC)",
                      border: "1px solid rgba(0,0,0,0.5)",
                      borderRadius: 2,
                      touchAction: "none",
                    }}
                    onPointerDown={(e) =>
                      startScale(box.groupIndex, box.wordIndex, box.segmentId, e)
                    }
                  />
                ))}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
});
