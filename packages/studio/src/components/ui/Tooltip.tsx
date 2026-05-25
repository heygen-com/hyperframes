import { useState, useRef, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  label: string;
  children: ReactNode;
  delay?: number;
  side?: "top" | "bottom";
}

export function Tooltip({ label, children, delay = 400, side = "top" }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => {
      const el = triggerRef.current;
      if (!el) return;
      const child = el.firstElementChild as HTMLElement | null;
      const rect = (child ?? el).getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      setPos({
        x: rect.left + rect.width / 2,
        y: side === "top" ? rect.top - 6 : rect.bottom + 6,
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

  return (
    <>
      <span ref={triggerRef} onPointerEnter={show} onPointerLeave={hide} className="contents">
        {children}
      </span>
      {visible &&
        createPortal(
          <div
            className="fixed z-[200] pointer-events-none"
            style={{
              left: pos.x,
              top: pos.y,
              transform: side === "top" ? "translate(-50%, -100%)" : "translate(-50%, 0)",
            }}
          >
            <div className="px-2 py-1 rounded-md bg-neutral-800 border border-neutral-700/50 text-[10px] font-medium text-neutral-200 whitespace-nowrap shadow-lg">
              {label}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
