import { useCallback, useLayoutEffect, useRef } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import { readWaveformViewport, type WaveformViewport } from "./audioWaveformViewport";

type WaveformDraw = (canvas: HTMLCanvasElement, viewport: WaveformViewport) => void;

interface PaintedWaveform {
  canvas: HTMLCanvasElement;
  viewport: WaveformViewport;
  height: number;
}

function isViewportCovered(current: WaveformViewport, painted: WaveformViewport): boolean {
  const visibleLeft = current.visibleLeft ?? current.left;
  const visibleRight = visibleLeft + (current.visibleWidth ?? current.width);
  return (
    current.fullWidth === painted.fullWidth &&
    visibleLeft >= painted.left &&
    visibleRight <= painted.left + painted.width
  );
}

export function useWaveformViewport(draw: WaveformDraw) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const cleanupRef = useRef<(() => void) | null>(null);
  const paintedRef = useRef<PaintedWaveform | null>(null);
  const didMountLayoutRef = useRef(false);
  const setCanvasRef = useCallback((canvas: HTMLCanvasElement | null) => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    paintedRef.current = null;
    canvasRef.current = canvas;
    const container = canvas?.parentElement;
    if (!canvas || !container) return;
    let frame = 0;
    const paint = (force = false) => {
      const current = canvasRef.current;
      if (!current || current !== canvas) return;
      const viewport = readWaveformViewport(container);
      const previous = paintedRef.current;
      const height = current.clientHeight;
      if (
        !force &&
        previous &&
        previous.canvas === current &&
        previous.height === height &&
        isViewportCovered(viewport, previous.viewport)
      ) {
        return;
      }
      drawRef.current(current, viewport);
      paintedRef.current = { canvas: current, viewport, height };
    };
    let forcePaint = false;
    const schedule = (force = false) => {
      forcePaint ||= force;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        const shouldForcePaint = forcePaint;
        forcePaint = false;
        frame = 0;
        paint(shouldForcePaint);
      });
    };
    const viewport = container.closest("[data-timeline-scroll-viewport]");
    let canvasHeight = canvas.clientHeight;
    const resize = new ResizeObserver((entries) => {
      const height = canvas.clientHeight;
      if (height === canvasHeight && entries.every((entry) => entry.target === canvas)) return;
      canvasHeight = height;
      schedule(true);
    });
    resize.observe(container);
    resize.observe(canvas);
    if (viewport instanceof HTMLElement) resize.observe(viewport);
    const geometry = new MutationObserver(() => schedule());
    for (
      let ancestor = container.parentElement;
      ancestor && ancestor !== viewport && ancestor !== document.body;
      ancestor = ancestor.parentElement
    ) {
      geometry.observe(ancestor, { attributes: true, attributeFilter: ["style"] });
    }
    const theme = new MutationObserver(() => schedule(true));
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-chrome", "data-theme", "style"],
    });
    const onScroll = () => schedule();
    const onWindowResize = () => schedule(true);
    viewport?.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onWindowResize);
    paint(true);
    cleanupRef.current = () => {
      if (frame) cancelAnimationFrame(frame);
      resize.disconnect();
      geometry.disconnect();
      theme.disconnect();
      viewport?.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onWindowResize);
      paintedRef.current = null;
    };
  }, []);
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (canvas && didMountLayoutRef.current) {
      const container = canvas.parentElement;
      if (container) {
        const viewport = readWaveformViewport(container);
        drawRef.current(canvas, viewport);
        paintedRef.current = { canvas, viewport, height: canvas.clientHeight };
      }
    }
    didMountLayoutRef.current = true;
  }, [draw]);
  useMountEffect(() => () => {
    cleanupRef.current?.();
    paintedRef.current = null;
  });
  return setCanvasRef;
}
