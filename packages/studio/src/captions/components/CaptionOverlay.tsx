import { memo, useEffect, useState, useCallback, useRef } from "react";
import { useLivePreviewIframe } from "../../player/store/previewIframeStore";
import { useCaptionStore } from "../store";
import { usePlayerStore } from "../../player";
import { resolveCaptionNudge, isEditableEventTarget } from "../keyboard";
import { matchesKey } from "../../player/components/studioShortcuts";
import { previewFrameOpaque } from "../../player/lib/previewChannel";
import {
  dragTransform,
  moveSealedDrag,
  pressSealedDrag,
  readFrameWordBoxes,
  restoreSealedDrag,
  sealedNudger,
  transformStyle,
  type DragStart,
  type SealedDrag,
  readWordBoxes,
  getWordEl,
  readGsapTransform,
  getOrCreateWrapper,
  writeTransform,
  computeTransformStyle,
  registerCaptionIframe,
  type WordBox,
} from "./CaptionOverlayUtils";

interface CaptionOverlayProps {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
}

const HANDLE = 8; // visual size of a handle dot
const HANDLE_HIT = 24; // pointer target size (invisible padding around the dot)
const ROTATION_OFFSET = 20; // px above the selection box

/** Sync canvas state back to the Zustand store so the property panel reflects it. */
function syncToStore(segmentId: string, el: HTMLElement, iframeWin: Window) {
  storeStyle(segmentId, computeTransformStyle(el, iframeWin));
}

function storeStyle(segmentId: string, style: Record<string, number>) {
  if (Object.keys(style).length > 0) {
    useCaptionStore.getState().updateSegmentStyle(segmentId, style);
  }
}

export const CaptionOverlay = memo(function CaptionOverlay({ iframeRef }: CaptionOverlayProps) {
  const isEditMode = useCaptionStore((s) => s.isEditMode);
  const livePreviewIframe = useLivePreviewIframe();
  const model = useCaptionStore((s) => s.model);
  const selectedSegmentIds = useCaptionStore((s) => s.selectedSegmentIds);
  const selectSegment = useCaptionStore((s) => s.selectSegment);
  const clearSelection = useCaptionStore((s) => s.clearSelection);

  const [wordBoxes, setWordBoxes] = useState<WordBox[]>([]);
  const overlayRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef(model);
  modelRef.current = model;
  // Set by the mount effect; lets Escape handling cancel an in-flight drag.
  const cancelDragRef = useRef<(() => boolean) | null>(null);

  // Interaction mode — only one active at a time
  const interactionRef = useRef<(DragStart & { wordEl: HTMLElement; segmentId: string }) | null>(
    null,
  );
  const sealedDragRef = useRef<SealedDrag | null>(null);
  const liveRef = useRef(false);

  // The observer and message filter bind to the live iframe element, which a promoted reload replaces.
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!isEditMode) return;
    liveRef.current = true;

    // Let undo/redo (useAppHotkeys) reapply restored models to this iframe.
    const unregisterIframe = registerCaptionIframe(iframeRef);

    let prevBoxes: WordBox[] = [];
    let rafId: number | null = null;
    let disposed = false;
    let reading = false;
    let readAgain = false;
    const tick = () => {
      rafId = null;
      const iframe = iframeRef.current;
      const m = modelRef.current;
      const overlay = overlayRef.current;
      if (!iframe || !m || !overlay) return;
      if (previewFrameOpaque(iframe)) return readSealed(iframe, m, overlay);
      show(readWordBoxes(iframe, m, overlay));
    };
    // One frame read in flight; triggers meanwhile collapse into one more read after it.
    const readSealed = (
      iframe: HTMLIFrameElement,
      m: NonNullable<typeof model>,
      overlay: HTMLElement,
    ) => {
      if (reading) {
        readAgain = true;
        return;
      }
      reading = true;
      void readFrameWordBoxes(iframe, m, overlay).then((next) => {
        reading = false;
        if (disposed) return;
        if (next) show(next);
        if (readAgain) {
          readAgain = false;
          scheduleTick();
        }
      });
    };
    const show = (next: WordBox[]) => {
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
    // Coalesce bursts of triggers (player store updates, resize) into one
    // layout read per frame — replaces the old unconditional 66ms polling.
    const scheduleTick = () => {
      if (rafId === null) rafId = requestAnimationFrame(tick);
    };

    // Event sources: player state changes (seek/scrub/select), preview
    // messages, element resize, window resize.
    const unsubPlayer = usePlayerStore.subscribe(scheduleTick);
    const handleMessage = (e: MessageEvent) => {
      if (!e.source || e.source !== iframeRef.current?.contentWindow) return;
      const data = e.data;
      if (data?.source === "hf-preview") scheduleTick();
    };
    window.addEventListener("message", handleMessage);
    window.addEventListener("resize", scheduleTick);
    const resizeObserver = new ResizeObserver(scheduleTick);
    if (iframeRef.current) resizeObserver.observe(iframeRef.current);
    if (overlayRef.current) resizeObserver.observe(overlayRef.current);

    // During playback caption groups animate continuously — a light interval
    // is the only reliable driver, but it runs ONLY while playing.
    let playInterval: ReturnType<typeof setInterval> | null = null;
    const syncPlaybackInterval = () => {
      const playing = usePlayerStore.getState().isPlaying;
      if (playing && playInterval === null) {
        playInterval = setInterval(scheduleTick, 66);
      } else if (!playing && playInterval !== null) {
        clearInterval(playInterval);
        playInterval = null;
      }
    };
    const unsubPlayback = usePlayerStore.subscribe(syncPlaybackInterval);
    syncPlaybackInterval();
    tick();

    const getWin = (): Window | null => {
      try {
        return iframeRef.current?.contentWindow ?? null;
      } catch {
        return null;
      }
    };

    const cancelActiveDrag = (): boolean => {
      const sealed = sealedDragRef.current;
      if (sealed) {
        sealedDragRef.current = null;
        restoreSealedDrag(sealed);
        return true;
      }
      const i = interactionRef.current;
      if (!i) return false;
      const win = getWin();
      if (win) {
        // Restore the pre-drag transform instead of committing the partial one.
        writeTransform(i.wordEl, win, i.origTX, i.origTY, i.origScale, i.origRotation);
      }
      interactionRef.current = null;
      return true;
    };
    cancelDragRef.current = cancelActiveDrag;

    const handleKeyDown = (e: KeyboardEvent) => {
      const store = useCaptionStore.getState();
      const { selectedSegmentIds: sel, model: m } = store;

      // Escape: cancel an in-flight drag first, else clear the selection.
      if (matchesKey(e, "cancel")) {
        if (cancelActiveDrag()) {
          e.preventDefault();
          scheduleTick();
          return;
        }
        if (sel.size > 0) {
          e.preventDefault();
          store.clearSelection();
        }
        return;
      }

      // ⌘A / Ctrl+A selects every caption word (unless typing in a field).
      if (matchesKey(e, "captionSelectAll") && !isEditableEventTarget(e.target)) {
        e.preventDefault();
        store.selectAll();
        return;
      }

      if (sel.size === 0 || !m) return;
      // Pass the event target so arrows inside inputs keep their native
      // behavior instead of nudging the canvas word.
      const nudge = resolveCaptionNudge(e, e.target);
      if (!nudge) return;

      e.preventDefault();
      const { dx, dy } = nudge;

      const iframe = iframeRef.current;
      if (iframe && previewFrameOpaque(iframe)) {
        void nudgeSealed(iframe, m, sel, dx, dy).then(scheduleTick);
        return;
      }
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
      scheduleTick();
    };

    const nudgeSealed = sealedNudger(
      () => !disposed,
      (segId, moved) => storeStyle(segId, transformStyle(moved)),
    );

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      disposed = true;
      liveRef.current = false;
      unregisterIframe();
      unsubPlayer();
      unsubPlayback();
      if (playInterval !== null) clearInterval(playInterval);
      if (rafId !== null) cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("resize", scheduleTick);
      window.removeEventListener("keydown", handleKeyDown);
      cancelDragRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livePreviewIframe]);

  const getCssScale = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return 1;
    const rect = iframe.getBoundingClientRect();
    const nativeW = parseFloat(iframe.style.width) || rect.width;
    return rect.width / nativeW;
  }, [iframeRef]);

  /** A press on a frame Studio cannot read: the drag starts from the word the frame reports. */
  const startSealedDrag = useCallback(
    (
      type: DragStart["type"],
      word: { group: number; word: number },
      segmentId: string,
      e: React.PointerEvent,
    ) => {
      const iframe = iframeRef.current;
      if (!iframe) return;
      const press = {
        startMX: e.clientX,
        startMY: e.clientY,
        cssScale: getCssScale(),
        left: iframe.getBoundingClientRect().left,
      };
      sealedDragRef.current = pressSealedDrag(iframe, type, word, segmentId, press);
    },
    [iframeRef, getCssScale],
  );

  // --- Move ---
  const startMove = useCallback(
    (groupIndex: number, wordIndex: number, segmentId: string, e: React.PointerEvent) => {
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const iframe = iframeRef.current;
      if (!iframe) return;
      if (previewFrameOpaque(iframe))
        return startSealedDrag("move", { group: groupIndex, word: wordIndex }, segmentId, e);
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
    [iframeRef, startSealedDrag],
  );

  // --- Scale ---
  const startScale = useCallback(
    (groupIndex: number, wordIndex: number, segmentId: string, e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const iframe = iframeRef.current;
      if (!iframe) return;
      if (previewFrameOpaque(iframe))
        return startSealedDrag("scale", { group: groupIndex, word: wordIndex }, segmentId, e);
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
    [iframeRef, getCssScale, startSealedDrag],
  );

  // --- Rotate ---
  const startRotate = useCallback(
    (box: WordBox, e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const iframe = iframeRef.current;
      if (!iframe) return;
      if (previewFrameOpaque(iframe))
        return startSealedDrag(
          "rotate",
          { group: box.groupIndex, word: box.wordIndex },
          box.segmentId,
          e,
        );
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
    [iframeRef, startSealedDrag],
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
      const sealed = sealedDragRef.current;
      if (sealed) return moveSealedDrag(sealed, e.clientX, e.clientY, getCssScale());
      const i = interactionRef.current;
      if (!i) return;
      const win = getIframeWin();
      if (!win) return;

      const t = dragTransform(i, e.clientX, e.clientY, getCssScale());
      writeTransform(i.wordEl, win, t.x, t.y, t.scale, t.rotation);
    },
    [getCssScale, getIframeWin],
  );

  // --- Unified pointer up — sync back to store ---
  const handlePointerUp = useCallback(() => {
    const sealed = sealedDragRef.current;
    if (sealed) {
      sealedDragRef.current = null;
      void sealed.last.then(
        (t) => t && liveRef.current && storeStyle(sealed.segmentId, transformStyle(t)),
      );
      return;
    }
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
      {wordBoxes.length === 0 && model && model.segments.size > 0 && (
        <div className="absolute inset-x-0 top-3 flex justify-center pointer-events-none">
          <span className="px-2.5 py-1 rounded-full bg-black/60 border border-neutral-700 text-2xs text-neutral-300">
            No captions visible at this frame. Scrub to a caption, or select one in the track below
          </span>
        </div>
      )}
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
                {/* Rotation handle — 24px hit area around an 8px dot */}
                <div
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: -ROTATION_OFFSET - HANDLE / 2 - HANDLE_HIT / 2,
                    marginLeft: -HANDLE_HIT / 2,
                    width: HANDLE_HIT,
                    height: HANDLE_HIT,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "grab",
                    touchAction: "none",
                  }}
                  onPointerDown={(e) => startRotate(box, e)}
                >
                  <div
                    style={{
                      width: HANDLE,
                      height: HANDLE,
                      borderRadius: "50%",
                      backgroundColor: "var(--hf-accent, #3CE6AC)",
                      border: "1px solid rgba(0,0,0,0.5)",
                    }}
                  />
                </div>
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
                {/* Scale handles — four corners, 24px hit areas around 8px dots */}
                {[
                  {
                    corner: { right: -HANDLE_HIT / 2, bottom: -HANDLE_HIT / 2 },
                    cursor: "nwse-resize",
                  },
                  {
                    corner: { left: -HANDLE_HIT / 2, top: -HANDLE_HIT / 2 },
                    cursor: "nwse-resize",
                  },
                  {
                    corner: { right: -HANDLE_HIT / 2, top: -HANDLE_HIT / 2 },
                    cursor: "nesw-resize",
                  },
                  {
                    corner: { left: -HANDLE_HIT / 2, bottom: -HANDLE_HIT / 2 },
                    cursor: "nesw-resize",
                  },
                ].map(({ corner, cursor }, idx) => (
                  <div
                    key={idx}
                    style={{
                      position: "absolute",
                      ...corner,
                      width: HANDLE_HIT,
                      height: HANDLE_HIT,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor,
                      touchAction: "none",
                    }}
                    onPointerDown={(e) =>
                      startScale(box.groupIndex, box.wordIndex, box.segmentId, e)
                    }
                  >
                    <div
                      style={{
                        width: HANDLE,
                        height: HANDLE,
                        backgroundColor: "var(--hf-accent, #3CE6AC)",
                        border: "1px solid rgba(0,0,0,0.5)",
                        borderRadius: 2,
                      }}
                    />
                  </div>
                ))}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
});
