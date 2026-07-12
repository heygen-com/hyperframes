import { useState, useRef, useCallback, useEffect, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  label: string;
  children: ReactNode;
  delay?: number;
  side?: "top" | "bottom";
}

// Rough bubble height (padding + one text line) used to decide flipping
// before the bubble has rendered; exact height isn't needed for the guard.
const APPROX_BUBBLE_H = 28;
const VIEWPORT_MARGIN = 8;

export function Tooltip({ label, children, delay = 400, side = "top" }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [resolvedSide, setResolvedSide] = useState<"top" | "bottom">(side);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  // WCAG 4.1.2: programmatically associate the bubble with its trigger.
  const tooltipId = useId();

  const show = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const el = triggerRef.current;
      if (!el) return;
      const child = el.firstElementChild as HTMLElement | null;
      const rect = (child ?? el).getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      // Flip when the preferred side would clip the viewport edge.
      let nextSide = side;
      if (side === "top" && rect.top - APPROX_BUBBLE_H - 6 < VIEWPORT_MARGIN) {
        nextSide = "bottom";
      } else if (
        side === "bottom" &&
        rect.bottom + APPROX_BUBBLE_H + 6 > window.innerHeight - VIEWPORT_MARGIN
      ) {
        nextSide = "top";
      }
      const x = Math.min(
        Math.max(rect.left + rect.width / 2, VIEWPORT_MARGIN),
        window.innerWidth - VIEWPORT_MARGIN,
      );
      setResolvedSide(nextSide);
      setPos({
        x,
        y: nextSide === "top" ? rect.top - 6 : rect.bottom + 6,
      });
      setVisible(true);
    }, delay);
  }, [delay, side]);

  const hide = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(false);
  }, []);

  // WCAG 1.4.13: tooltip content must be dismissible with Escape.
  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [visible, hide]);

  return (
    <>
      <span
        ref={triggerRef}
        onPointerEnter={show}
        onPointerLeave={hide}
        onFocus={show}
        onBlur={hide}
        aria-describedby={visible ? tooltipId : undefined}
        className="contents"
      >
        {children}
      </span>
      {visible &&
        createPortal(
          <div
            className="fixed z-[200] pointer-events-none"
            style={{
              left: pos.x,
              top: pos.y,
              transform: resolvedSide === "top" ? "translate(-50%, -100%)" : "translate(-50%, 0)",
            }}
          >
            <div
              role="tooltip"
              id={tooltipId}
              className="px-2 py-1 rounded-md bg-neutral-800 border border-neutral-700/50 text-[10px] font-medium text-neutral-200 whitespace-nowrap shadow-lg"
            >
              {label}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
