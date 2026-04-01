import { memo, useState, useCallback, useRef } from "react";
import { useCaptionStore } from "../store";
import { useMountEffect } from "../../hooks/useMountEffect";

interface CaptionOverlayProps {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
}

interface WordBox {
  segmentId: string;
  groupId: string;
  groupIndex: number;
  wordIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

function readWordBoxes(
  iframe: HTMLIFrameElement,
  model: {
    groupOrder: string[];
    groups: Map<string, { segmentIds: string[] }>;
  },
  overlayEl: HTMLElement,
): WordBox[] {
  let doc: Document | null = null;
  let win: Window | null = null;
  try {
    doc = iframe.contentDocument;
    win = iframe.contentWindow;
  } catch {
    return [];
  }
  if (!doc || !win) return [];

  const iframeDisplayRect = iframe.getBoundingClientRect();
  const overlayRect = overlayEl.getBoundingClientRect();
  const nativeW = parseFloat(iframe.style.width) || iframeDisplayRect.width;
  const cssScale = iframeDisplayRect.width / nativeW;
  const offsetX = iframeDisplayRect.left - overlayRect.left;
  const offsetY = iframeDisplayRect.top - overlayRect.top;

  const groupEls = doc.querySelectorAll<HTMLElement>(".caption-group");
  const boxes: WordBox[] = [];

  for (let gi = 0; gi < model.groupOrder.length; gi++) {
    const groupId = model.groupOrder[gi];
    const group = model.groups.get(groupId);
    if (!group) continue;
    const groupEl = groupEls[gi] as HTMLElement | undefined;
    if (!groupEl) continue;
    const computed = win.getComputedStyle(groupEl);
    if (parseFloat(computed.opacity) <= 0.01 || computed.visibility === "hidden") continue;
    const wordEls = groupEl.querySelectorAll<HTMLElement>(":scope > span");
    for (let wi = 0; wi < group.segmentIds.length; wi++) {
      const segId = group.segmentIds[wi];
      const wordEl = wordEls[wi] as HTMLElement | undefined;
      if (!wordEl) continue;
      const rect = wordEl.getBoundingClientRect();
      boxes.push({
        segmentId: segId, groupId, groupIndex: gi, wordIndex: wi,
        x: rect.left * cssScale + offsetX,
        y: rect.top * cssScale + offsetY,
        width: rect.width * cssScale,
        height: rect.height * cssScale,
      });
    }
  }
  return boxes;
}

function getWordEl(iframe: HTMLIFrameElement, groupIndex: number, wordIndex: number): HTMLElement | null {
  let doc: Document | null = null;
  try { doc = iframe.contentDocument; } catch { return null; }
  if (!doc) return null;
  const groupEl = doc.querySelectorAll<HTMLElement>(".caption-group")[groupIndex];
  if (!groupEl) return null;
  return groupEl.querySelectorAll<HTMLElement>(":scope > span")[wordIndex] ?? null;
}

/**
 * Read GSAP's internal transform state for an element.
 * GSAP stores transforms in its own cache, not in el.style.transform.
 */
function readGsapTransform(el: HTMLElement, iframeWin: Window): { x: number; y: number; scale: number; rotation: number } {
  const gsap = (iframeWin as unknown as { gsap?: { getProperty?: (el: HTMLElement, prop: string) => number } }).gsap;
  if (gsap && gsap.getProperty) {
    return {
      x: gsap.getProperty(el, "x") || 0,
      y: gsap.getProperty(el, "y") || 0,
      scale: gsap.getProperty(el, "scale") || 1,
      rotation: gsap.getProperty(el, "rotation") || 0,
    };
  }
  // Fallback: parse from style
  const t = el.style.transform || "";
  const scaleMatch = t.match(/scale\(([^)]+)\)/);
  const rotMatch = t.match(/rotate\(([^)]+)deg\)/);
  const txyMatch = t.match(/translate\(([^,]+)px,\s*([^)]+)px\)/);
  return {
    x: txyMatch ? parseFloat(txyMatch[1]) : 0,
    y: txyMatch ? parseFloat(txyMatch[2]) : 0,
    scale: scaleMatch ? parseFloat(scaleMatch[1]) : 1,
    rotation: rotMatch ? parseFloat(rotMatch[1]) : 0,
  };
}

/**
 * Get or create an inline-block wrapper span around a word element.
 * Transforms are applied to the wrapper so the word's GSAP animations are preserved.
 */
function getOrCreateWrapper(el: HTMLElement): HTMLElement {
  const parent = el.parentElement;
  if (parent && parent.dataset.captionWrapper === "true") return parent;
  const doc = el.ownerDocument;
  const wrapper = doc.createElement("span");
  wrapper.style.display = "inline-block";
  wrapper.dataset.captionWrapper = "true";
  el.parentNode?.insertBefore(wrapper, el);
  wrapper.appendChild(el);
  return wrapper;
}

/**
 * Write transform values to a wrapper span around the word element.
 * The word keeps its GSAP animations; the wrapper handles editor transforms.
 */
function writeTransform(el: HTMLElement, iframeWin: Window, x: number, y: number, scale: number, rotation: number) {
  const wrapper = getOrCreateWrapper(el);
  const gsap = (iframeWin as unknown as { gsap?: { set?: (el: HTMLElement, props: Record<string, number>) => void } }).gsap;
  if (gsap && gsap.set) {
    gsap.set(wrapper, { x, y, scale, rotation });
  } else {
    wrapper.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${rotation.toFixed(1)}deg) scale(${scale.toFixed(3)})`;
  }
}

/** Sync canvas state back to the Zustand store so the property panel reflects it */
function syncToStore(segmentId: string, el: HTMLElement, iframeWin: Window) {
  const wrapper = getOrCreateWrapper(el);
  const { x, y, scale, rotation } = readGsapTransform(wrapper, iframeWin);
  useCaptionStore.getState().updateSegmentStyle(segmentId, {
    x, y, rotation, scaleX: scale, scaleY: scale,
  });
}

const HANDLE = 8;
const ROTATION_OFFSET = 20; // px above the selection box

export const CaptionOverlay = memo(function CaptionOverlay({
  iframeRef,
}: CaptionOverlayProps) {
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
    | { type: "move"; wordEl: HTMLElement; segmentId: string; startMX: number; startMY: number; origTX: number; origTY: number; origScale: number; origRotation: number }
    | { type: "scale"; wordEl: HTMLElement; segmentId: string; startMX: number; startWidth: number; origTX: number; origTY: number; origScale: number; origRotation: number }
    | { type: "rotate"; wordEl: HTMLElement; segmentId: string; centerX: number; centerY: number; startAngle: number; origTX: number; origTY: number; origRotation: number; origScale: number }
    | null
  >(null);

  useMountEffect(() => {
    if (!isEditMode) return;
    const tick = () => {
      const iframe = iframeRef.current;
      const m = modelRef.current;
      const overlay = overlayRef.current;
      if (!iframe || !m || !overlay) return;
      setWordBoxes(readWordBoxes(iframe, m, overlay));
    };
    const id = setInterval(tick, 66);
    tick();
    return () => clearInterval(id);
  });

  const getCssScale = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return 1;
    const rect = iframe.getBoundingClientRect();
    const nativeW = parseFloat(iframe.style.width) || rect.width;
    return rect.width / nativeW;
  }, [iframeRef]);

  // --- Move ---
  const startMove = useCallback((groupIndex: number, wordIndex: number, segmentId: string, e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const iframe = iframeRef.current;
    if (!iframe) return;
    const wordEl = getWordEl(iframe, groupIndex, wordIndex);
    const win = iframe.contentWindow;
    if (!wordEl || !win) return;
    const state = readGsapTransform(getOrCreateWrapper(wordEl), win);
    interactionRef.current = {
      type: "move", wordEl, segmentId,
      startMX: e.clientX, startMY: e.clientY,
      origTX: state.x, origTY: state.y,
      origScale: state.scale, origRotation: state.rotation,
    };
  }, [iframeRef]);

  // --- Scale ---
  const startScale = useCallback((groupIndex: number, wordIndex: number, segmentId: string, e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const iframe = iframeRef.current;
    if (!iframe) return;
    const wordEl = getWordEl(iframe, groupIndex, wordIndex);
    const win = iframe.contentWindow;
    if (!wordEl || !win) return;
    const rect = wordEl.getBoundingClientRect();
    const state = readGsapTransform(getOrCreateWrapper(wordEl), win);
    interactionRef.current = {
      type: "scale", wordEl, segmentId,
      startMX: e.clientX, startWidth: rect.width,
      origTX: state.x, origTY: state.y,
      origScale: state.scale, origRotation: state.rotation,
    };
  }, [iframeRef]);

  // --- Rotate ---
  const startRotate = useCallback((box: WordBox, e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const iframe = iframeRef.current;
    if (!iframe) return;
    const wordEl = getWordEl(iframe, box.groupIndex, box.wordIndex);
    const win = iframe.contentWindow;
    if (!wordEl || !win) return;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI);
    const state = readGsapTransform(getOrCreateWrapper(wordEl), win);
    interactionRef.current = {
      type: "rotate", wordEl, segmentId: box.segmentId,
      centerX: cx, centerY: cy,
      startAngle, origTX: state.x, origTY: state.y,
      origRotation: state.rotation, origScale: state.scale,
    };
  }, [iframeRef]);

  /** Get iframe contentWindow, needed for gsap calls */
  const getIframeWin = useCallback((): Window | null => {
    try { return iframeRef.current?.contentWindow ?? null; } catch { return null; }
  }, [iframeRef]);

  // --- Unified pointer move ---
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
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
      const dx = e.clientX - i.startMX;
      const factor = 1 + dx / Math.max(i.startWidth, 50);
      const newScale = Math.max(0.1, i.origScale * factor);
      writeTransform(i.wordEl, win, i.origTX, i.origTY, newScale, i.origRotation);
    } else if (i.type === "rotate") {
      const angle = Math.atan2(e.clientY - i.centerY, e.clientX - i.centerX) * (180 / Math.PI);
      const delta = angle - i.startAngle;
      writeTransform(i.wordEl, win, i.origTX, i.origTY, i.origScale, i.origRotation + delta);
    }
  }, [getCssScale, getIframeWin]);

  // --- Unified pointer up — sync back to store ---
  const handlePointerUp = useCallback(() => {
    const i = interactionRef.current;
    if (i) {
      const win = getIframeWin();
      if (win) syncToStore(i.segmentId, i.wordEl, win);
      interactionRef.current = null;
    }
  }, [getIframeWin]);

  const handleBackgroundClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) clearSelection();
  }, [clearSelection]);

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
              left: box.x, top: box.y, width: box.width, height: box.height,
              cursor: isSelected ? "move" : "pointer",
              touchAction: "none", borderRadius: 2,
            }}
            onClick={(e) => { e.stopPropagation(); selectSegment(box.segmentId, e.shiftKey); }}
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
                    left: "50%", top: -ROTATION_OFFSET - HANDLE,
                    marginLeft: -HANDLE / 2,
                    width: HANDLE, height: HANDLE,
                    borderRadius: "50%",
                    backgroundColor: "var(--hf-accent, #3CE6AC)",
                    border: "1px solid rgba(0,0,0,0.5)",
                    cursor: "grab", touchAction: "none",
                  }}
                  onPointerDown={(e) => startRotate(box, e)}
                />
                {/* Line from box to rotation handle */}
                <div
                  style={{
                    position: "absolute",
                    left: "50%", top: -ROTATION_OFFSET,
                    width: 1, height: ROTATION_OFFSET,
                    marginLeft: -0.5,
                    backgroundColor: "var(--hf-accent, #3CE6AC)",
                    opacity: 0.5, pointerEvents: "none",
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
                      position: "absolute", ...pos,
                      width: HANDLE, height: HANDLE,
                      backgroundColor: "var(--hf-accent, #3CE6AC)",
                      border: "1px solid rgba(0,0,0,0.5)",
                      borderRadius: 2, touchAction: "none",
                    }}
                    onPointerDown={(e) => startScale(box.groupIndex, box.wordIndex, box.segmentId, e)}
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
