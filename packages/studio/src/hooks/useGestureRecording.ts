import { useCallback, useEffect, useRef, useState } from "react";
import { usePlayerStore, liveTime } from "../player/store/playerStore";

export interface GestureSample {
  time: number;
  properties: Record<string, number>;
}

interface Modifiers {
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

interface AccumulatedState {
  opacity: number;
  scale: number;
  z: number;
}

function resolveGestureProperties(
  dx: number,
  dy: number,
  scrollDelta: number,
  modifiers: Modifiers,
  accumulatedState: AccumulatedState,
): {
  properties: Record<string, number>;
  nextState: AccumulatedState;
} {
  const properties: Record<string, number> = {};
  let nextOpacity = accumulatedState.opacity;
  let nextScale = accumulatedState.scale;
  let nextZ = accumulatedState.z;

  if (modifiers.meta) {
    // Opacity derived from total vertical displacement (absolute, not accumulated).
    // Dragging down reduces opacity; dragging back up restores it.
    nextOpacity = Math.max(0, Math.min(1, 1 - dy * 0.005));
    properties.opacity = nextOpacity;
    if (scrollDelta !== 0) {
      nextScale = Math.max(0.01, accumulatedState.scale + scrollDelta * 0.01);
      properties.scale = nextScale;
    }
  } else if (modifiers.shift) {
    properties.rotationX = dy * 0.5;
    properties.rotationY = dx * 0.5;
  } else if (modifiers.alt) {
    properties.rotation = dx * 0.5;
  } else {
    properties.x = dx;
    properties.y = dy;
  }

  if (!modifiers.meta && scrollDelta !== 0) {
    nextZ = accumulatedState.z + scrollDelta;
    properties.z = nextZ;
  }

  return {
    properties,
    nextState: { opacity: nextOpacity, scale: nextScale, z: nextZ },
  };
}

export function useGestureRecording() {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);

  // Synchronous guard — immune to React's async state batching.
  // startRecording and stopRecording check this ref, not the useState value.
  const isRecordingRef = useRef(false);

  const pointerRef = useRef({ x: 0, y: 0 });
  const startPointerRef = useRef({ x: 0, y: 0 });
  const scrollDeltaRef = useRef(0);
  const modifiersRef = useRef<Modifiers>({ shift: false, alt: false, meta: false });
  const accumulatedRef = useRef<AccumulatedState>({ opacity: 1, scale: 1, z: 0 });
  const basePositionRef = useRef({ x: 0, y: 0 });
  const scaleRef = useRef(1);
  const hasMovedRef = useRef(false);
  const pointerElementOffsetRef = useRef({ x: 0, y: 0 });
  const runtimeRef = useRef<{
    seek: (t: number) => void;
    set: (target: string, vars: Record<string, number>) => void;
    selector: string;
    element: HTMLElement;
    startTime: number;
    maxSeekTime: number;
  } | null>(null);

  const rafIdRef = useRef(0);
  const samplesRef = useRef<GestureSample[]>([]);
  const trailRef = useRef<Array<{ x: number; y: number }>>([]);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Unmount safety: cancel RAF + remove listeners if component tears down mid-recording.
  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
      isRecordingRef.current = false;
    };
  }, []);

  const startRecording = useCallback(
    (element: HTMLElement, iframeEl: HTMLIFrameElement, elementEndTime?: number) => {
      if (isRecordingRef.current) return;
      isRecordingRef.current = true;

      samplesRef.current = [];
      trailRef.current = [];
      hasMovedRef.current = false;
      setRecordingDuration(0);
      scrollDeltaRef.current = 0;

      let baseOpacity = 1;
      let baseScaleVal = 1;
      let baseX = 0;
      let baseY = 0;
      try {
        const gsap = (
          iframeEl.contentWindow as Window & {
            gsap?: { getProperty: (el: Element, prop: string) => number };
          }
        ).gsap;
        if (gsap?.getProperty) {
          baseOpacity = Number(gsap.getProperty(element, "opacity")) || 1;
          baseScaleVal = Number(gsap.getProperty(element, "scaleX")) || 1;
          baseX = Number(gsap.getProperty(element, "x")) || 0;
          baseY = Number(gsap.getProperty(element, "y")) || 0;
        }
      } catch {
        /* cross-origin guard */
      }
      // When reapplyPathOffsets has run (translate restored to var-based),
      // GSAP's cache was stripped — gsapX is 0 but the element is visually
      // at CSSLeft + translate(offset). gsap.set wipes translate, so we need
      // baseX to include the offset. When translate is "none" (GSAP owns it),
      // gsapX already includes the baked offset — don't add.
      const translateVal = element.style.translate ?? "";
      if (translateVal.includes("var(")) {
        const offX = Number.parseFloat(element.style.getPropertyValue("--hf-studio-offset-x")) || 0;
        const offY = Number.parseFloat(element.style.getPropertyValue("--hf-studio-offset-y")) || 0;
        baseX += offX;
        baseY += offY;
      }
      accumulatedRef.current = { opacity: baseOpacity, scale: baseScaleVal, z: 0 };
      basePositionRef.current = { x: baseX, y: baseY };

      const selector = element.id ? `#${element.id}` : null;
      try {
        const win = iframeEl.contentWindow as Window & {
          gsap?: { set: (t: string, v: Record<string, number>) => void };
          __timelines?: Record<string, { seek: (t: number) => void; duration: () => number }>;
          __player?: { getTime: () => number };
        };
        const tl = win?.__timelines ? Object.values(win.__timelines)[0] : null;
        if (win?.gsap?.set && tl?.seek && selector) {
          const tlDuration = tl.duration();
          runtimeRef.current = {
            seek: tl.seek.bind(tl),
            set: win.gsap.set.bind(win.gsap),
            selector,
            element,
            startTime: win.__player?.getTime() ?? 0,
            maxSeekTime:
              elementEndTime != null && elementEndTime < tlDuration ? elementEndTime : tlDuration,
          };
        }
      } catch {
        runtimeRef.current = null;
      }

      const iframeRect = iframeEl.getBoundingClientRect();
      const doc = iframeEl.contentDocument;
      const root = doc?.querySelector<HTMLElement>("[data-composition-id]") ?? doc?.documentElement;
      const declaredWidth = Number(root?.getAttribute("data-width")) || 1920;
      scaleRef.current = declaredWidth > 0 ? iframeRect.width / declaredWidth : 1;

      // Compute the offset between the element's visual center and the pointer
      // so the element tracks the pointer exactly during recording (no jump).
      const elRect = element.getBoundingClientRect();
      const elCenterViewport = {
        x: elRect.left + elRect.width / 2,
        y: elRect.top + elRect.height / 2,
      };
      pointerElementOffsetRef.current = { x: 0, y: 0 }; // reset; set on first move

      const handlePointerMove = (e: PointerEvent) => {
        pointerRef.current = { x: e.clientX, y: e.clientY };
        modifiersRef.current = {
          shift: e.shiftKey,
          alt: e.altKey,
          meta: e.metaKey || e.ctrlKey,
        };
      };

      const handleWheel = (e: WheelEvent) => {
        scrollDeltaRef.current += e.deltaY;
        modifiersRef.current = {
          shift: e.shiftKey,
          alt: e.altKey,
          meta: e.metaKey || e.ctrlKey,
        };
      };

      const handleKeyChange = (e: KeyboardEvent) => {
        modifiersRef.current = {
          shift: e.shiftKey,
          alt: e.altKey,
          meta: e.metaKey || e.ctrlKey,
        };
      };

      document.addEventListener("pointermove", handlePointerMove, { passive: true });
      document.addEventListener("wheel", handleWheel, { passive: true });
      document.addEventListener("keydown", handleKeyChange, { passive: true });
      document.addEventListener("keyup", handleKeyChange, { passive: true });

      startPointerRef.current = { ...pointerRef.current };
      const startMs = performance.now();

      let startCaptured = false;
      const captureStart = (e: PointerEvent) => {
        if (!startCaptured) {
          startPointerRef.current = { x: e.clientX, y: e.clientY };
          // Compute the offset between the pointer and the element center
          // so the element follows the pointer without jumping.
          pointerElementOffsetRef.current = {
            x: e.clientX - elCenterViewport.x,
            y: e.clientY - elCenterViewport.y,
          };
          startCaptured = true;
          hasMovedRef.current = true;
        }
      };
      document.addEventListener("pointermove", captureStart, { passive: true, once: true });

      const tick = () => {
        if (!isRecordingRef.current) return;
        const now = performance.now();
        const time = (now - startMs) / 1000;
        const scale = scaleRef.current || 1;
        const dx = (pointerRef.current.x - startPointerRef.current.x) / scale;
        const dy = (pointerRef.current.y - startPointerRef.current.y) / scale;
        const scrollDelta = scrollDeltaRef.current;

        // Skip zero-displacement samples before the pointer has moved.
        if (!hasMovedRef.current && dx === 0 && dy === 0 && scrollDelta === 0) {
          rafIdRef.current = requestAnimationFrame(tick);
          return;
        }
        hasMovedRef.current = true;

        const { properties, nextState } = resolveGestureProperties(
          dx,
          dy,
          scrollDelta,
          modifiersRef.current,
          accumulatedRef.current,
        );
        if ("x" in properties) properties.x = Math.round(basePositionRef.current.x + properties.x);
        if ("y" in properties) properties.y = Math.round(basePositionRef.current.y + properties.y);

        accumulatedRef.current = nextState;
        scrollDeltaRef.current = 0;

        // Manual seek on the raw GSAP timeline (not the Studio player wrapper,
        // which triggers React state updates). After seek renders all elements
        // at the correct time, gsap.set overrides the recorded element so it
        // follows the pointer. The browser paints the set values on this frame;
        // next tick's seek will overwrite, but we re-apply immediately.
        if (runtimeRef.current) {
          try {
            const seekTime = Math.min(
              runtimeRef.current.startTime + time,
              runtimeRef.current.maxSeekTime,
            );
            runtimeRef.current.seek(seekTime);
            runtimeRef.current.set(runtimeRef.current.selector, { ...properties });
            runtimeRef.current.element.style.visibility = "visible";
            liveTime.notify(seekTime);
            usePlayerStore.getState().setCurrentTime(seekTime);
          } catch {
            runtimeRef.current = null;
          }
        }

        samplesRef.current.push({ time, properties });
        trailRef.current.push({ x: pointerRef.current.x, y: pointerRef.current.y });
        setRecordingDuration(time);
        rafIdRef.current = requestAnimationFrame(tick);
      };

      setIsRecording(true);
      rafIdRef.current = requestAnimationFrame(tick);

      cleanupRef.current = () => {
        cancelAnimationFrame(rafIdRef.current);
        document.removeEventListener("pointermove", handlePointerMove);
        document.removeEventListener("wheel", handleWheel);
        document.removeEventListener("keydown", handleKeyChange);
        document.removeEventListener("keyup", handleKeyChange);
        document.removeEventListener("pointermove", captureStart);
      };
    },
    [], // No deps — uses refs only for all mutable state
  );

  const stopRecording = useCallback((): GestureSample[] => {
    if (!isRecordingRef.current) return [];
    isRecordingRef.current = false;
    runtimeRef.current = null;
    cleanupRef.current?.();
    cleanupRef.current = null;
    const frozen = samplesRef.current.slice();
    setRecordingDuration(frozen.length > 0 ? frozen[frozen.length - 1]!.time : 0);
    setIsRecording(false);
    return frozen;
  }, []); // No deps — uses refs only

  const clearSamples = useCallback(() => {
    samplesRef.current = [];
    trailRef.current = [];
    setRecordingDuration(0);
    accumulatedRef.current = { opacity: 1, scale: 1, z: 0 };
    scrollDeltaRef.current = 0;
  }, []);

  return {
    startRecording,
    stopRecording,
    isRecording,
    samplesRef,
    trailRef,
    recordingDuration,
    clearSamples,
  };
}
