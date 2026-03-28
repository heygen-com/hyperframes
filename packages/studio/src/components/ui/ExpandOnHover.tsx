import React, { useState, useRef, useCallback, useEffect, type ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";

interface ExpandOnHoverProps {
  children: ReactNode;
  expandedContent?: ReactNode | ((close: () => void) => ReactNode);
  expandScale?: number;
  delay?: number;
  className?: string;
  onClick?: () => void;
}

export function ExpandOnHover({
  children,
  expandedContent,
  expandScale = 0.75,
  delay = 300,
  className = "",
  onClick,
}: ExpandOnHoverProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [origin, setOrigin] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const expandedRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setIsExpanded(false);
  }, []);

  const open = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setOrigin({ x: rect.left, y: rect.top, w: rect.width, h: rect.height });
    setIsExpanded(true);
  }, []);

  const handleCardEnter = useCallback(() => {
    if (isExpanded) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(open, delay);
  }, [delay, open, isExpanded]);

  const handleCardLeave = useCallback(() => {
    if (isExpanded) return;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, [isExpanded]);

  // When expanded: track mouse position. If mouse stays outside the expanded
  // card for 600ms continuously, close. Any re-entry resets the timer.
  // Note: useEffect with [isExpanded] is acceptable — subscribes to window mousemove
  // only while expanded, with cleanup on collapse. Can't be a mount effect.
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!isExpanded) return;

    const CLOSE_DELAY = 600; // ms mouse must be outside to close
    const START_DELAY = 400; // ms before we start checking (let animation settle)
    let tracking = false;

    const startTracking = setTimeout(() => {
      tracking = true;
    }, START_DELAY);

    const handleMouseMove = (e: MouseEvent) => {
      if (!tracking) return;
      const el = expandedRef.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      // Add generous padding so edge movements don't trigger close
      const pad = 20;
      const inside =
        e.clientX >= rect.left - pad &&
        e.clientX <= rect.right + pad &&
        e.clientY >= rect.top - pad &&
        e.clientY <= rect.bottom + pad;

      if (inside) {
        // Mouse is inside — cancel any pending close
        if (closeTimerRef.current) {
          clearTimeout(closeTimerRef.current);
          closeTimerRef.current = null;
        }
      } else {
        // Mouse is outside — start close countdown if not already started
        if (!closeTimerRef.current) {
          closeTimerRef.current = setTimeout(() => {
            setIsExpanded(false);
          }, CLOSE_DELAY);
        }
      }
    };

    window.addEventListener("mousemove", handleMouseMove);

    return () => {
      clearTimeout(startTracking);
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, [isExpanded]);

  const vw = typeof window !== "undefined" ? window.innerWidth : 1440;
  const vh = typeof window !== "undefined" ? window.innerHeight : 900;
  const targetW = vw * expandScale;
  const targetH = vh * expandScale;
  const targetX = (vw - targetW) / 2;
  const targetY = (vh - targetH) / 2;

  return (
    <>
      <div
        ref={containerRef}
        className={className}
        onMouseEnter={handleCardEnter}
        onMouseLeave={handleCardLeave}
        onClick={onClick}
        style={{ opacity: isExpanded ? 0 : 1, transition: "opacity 100ms ease-out" }}
      >
        {children}
      </div>

      <AnimatePresence>
        {isExpanded && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
              onClick={close}
            />
            {/* Expanded card */}
            <motion.div
              ref={expandedRef}
              initial={{
                left: origin.x,
                top: origin.y,
                width: origin.w,
                height: origin.h,
              }}
              animate={{
                left: targetX,
                top: targetY,
                width: targetW,
                height: targetH,
              }}
              exit={{
                left: origin.x,
                top: origin.y,
                width: origin.w,
                height: origin.h,
              }}
              transition={{
                type: "spring",
                stiffness: 280,
                damping: 28,
                mass: 0.8,
              }}
              className="fixed z-50 overflow-hidden rounded-[16px] shadow-dialog"
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                close();
                onClick?.();
              }}
            >
              {typeof expandedContent === "function"
                ? expandedContent(close)
                : (expandedContent ?? children)}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
