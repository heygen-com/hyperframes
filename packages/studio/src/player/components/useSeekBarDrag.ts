import { useCallback } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import { formatFrameTime, formatTime } from "../lib/time";
import { usePlayerStore, liveTime } from "../store/playerStore";

const SEEK_EDGE_SNAP_PX = 8;

export function resolveSeekPercent(clientX: number, rectLeft: number, rectWidth: number): number {
  if (!Number.isFinite(rectWidth) || rectWidth <= 0) return 0;
  const rawPercent = (clientX - rectLeft) / rectWidth;
  const clamped = Math.max(0, Math.min(1, rawPercent));
  const snapThreshold = Math.min(0.5, SEEK_EDGE_SNAP_PX / rectWidth);
  if (clamped <= snapThreshold) return 0;
  if (clamped >= 1 - snapThreshold) return 1;
  return clamped;
}

interface SeekBarRefs {
  seekBarRef: React.RefObject<HTMLDivElement | null>;
  progressFillRef: React.RefObject<HTMLDivElement | null>;
  progressThumbRef: React.RefObject<HTMLDivElement | null>;
  sliderRef: React.RefObject<HTMLDivElement | null>;
  timeDisplayRef: React.RefObject<HTMLSpanElement | null>;
  isDraggingRef: React.MutableRefObject<boolean>;
  durationRef: React.MutableRefObject<number>;
  currentTimeRef: React.MutableRefObject<number>;
  timeDisplayModeRef: React.MutableRefObject<"time" | "frame">;
}

function updateProgressUI(
  fillRef: React.RefObject<HTMLDivElement | null>,
  thumbRef: React.RefObject<HTMLDivElement | null>,
  pct: number,
): void {
  if (fillRef.current) fillRef.current.style.width = `${pct}%`;
  if (thumbRef.current) thumbRef.current.style.left = `${pct}%`;
}

export function useSeekBarDrag(
  refs: SeekBarRefs,
  onSeek: (time: number) => void,
  disabled: boolean,
  duration: number,
) {
  const seekFromClientX = useCallback(
    (clientX: number) => {
      if (disabled) return;
      const bar = refs.seekBarRef.current;
      if (!bar || duration <= 0) return;
      const rect = bar.getBoundingClientRect();
      const percent = resolveSeekPercent(clientX, rect.left, rect.width);
      updateProgressUI(refs.progressFillRef, refs.progressThumbRef, percent * 100);
      onSeek(percent * duration);
    },
    [disabled, duration, onSeek, refs],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.focus();
      refs.isDraggingRef.current = true;

      const target = e.currentTarget;
      const pointerId = e.pointerId;
      try {
        target.setPointerCapture(pointerId);
      } catch {
        /* fallback to window listeners */
      }

      seekFromClientX(e.clientX);

      let seekRafId = 0;
      let pendingClientX = e.clientX;
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId || !refs.isDraggingRef.current) return;
        pendingClientX = ev.clientX;
        const bar = refs.seekBarRef.current;
        const dur = refs.durationRef.current;
        if (bar && dur > 0) {
          const rect = bar.getBoundingClientRect();
          const pct = resolveSeekPercent(ev.clientX, rect.left, rect.width) * 100;
          updateProgressUI(refs.progressFillRef, refs.progressThumbRef, pct);
        }
        if (!seekRafId) {
          seekRafId = requestAnimationFrame(() => {
            seekRafId = 0;
            if (refs.isDraggingRef.current) seekFromClientX(pendingClientX);
          });
        }
      };
      const cleanup = () => {
        refs.isDraggingRef.current = false;
        if (seekRafId) {
          cancelAnimationFrame(seekRafId);
          seekRafId = 0;
        }
        seekFromClientX(pendingClientX);
        try {
          target.releasePointerCapture(pointerId);
        } catch {
          /* already released */
        }
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        target.removeEventListener("pointercancel", onUp);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        window.removeEventListener("blur", cleanup);
        target.blur();
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        cleanup();
      };
      const onVisibilityChange = () => {
        if (document.visibilityState === "hidden") cleanup();
      };

      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
      target.addEventListener("pointercancel", onUp);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      document.addEventListener("visibilitychange", onVisibilityChange);
      window.addEventListener("blur", cleanup);
    },
    [seekFromClientX, refs],
  );

  useMountEffect(() => {
    const updateProgress = (t: number) => {
      refs.currentTimeRef.current = t;
      const dur = refs.durationRef.current;
      const pct = dur > 0 ? Math.min(100, (t / dur) * 100) : 0;
      updateProgressUI(refs.progressFillRef, refs.progressThumbRef, pct);
      if (refs.timeDisplayRef.current) {
        refs.timeDisplayRef.current.textContent =
          refs.timeDisplayModeRef.current === "frame" ? formatFrameTime(t, dur) : formatTime(t);
      }
      if (refs.sliderRef.current)
        refs.sliderRef.current.setAttribute("aria-valuenow", String(Math.round(t)));
    };
    const unsub = liveTime.subscribe(updateProgress);
    updateProgress(usePlayerStore.getState().currentTime);

    const interval = setInterval(() => {
      const t = usePlayerStore.getState().currentTime;
      const dur = usePlayerStore.getState().duration;
      if (dur > 0 && t > 0) {
        updateProgressUI(
          refs.progressFillRef,
          refs.progressThumbRef,
          Math.min(100, (t / dur) * 100),
        );
      }
    }, 500);

    return () => {
      unsub();
      clearInterval(interval);
    };
  });

  return { handlePointerDown };
}
