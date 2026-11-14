import { useState, useCallback, useRef } from "react";
import { useMountEffect } from "./useMountEffect";
import type { AppToast } from "../utils/studioHelpers";

interface ToastItem extends AppToast {
  id: number;
}

const AUTO_DISMISS_MS = 4000;
const MAX_TOASTS = 3;

/** Error toasts persist until dismissed so failures can't silently vanish. */
export const toastPersists = (tone: AppToast["tone"]) => tone === "error";

let nextToastId = 1;

/**
 * Stacked toasts (max 3). Info toasts auto-dismiss after 4s; error toasts persist.
 */
export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const clearTimer = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const dismissToast = useCallback(
    (id: number) => {
      clearTimer(id);
      setToasts((prev) => prev.filter((t) => t.id !== id));
    },
    [clearTimer],
  );

  const showToast = useCallback(
    (message: string, tone: AppToast["tone"] = "error"): number => {
      const id = nextToastId++;
      setToasts((prev) => {
        const next = [...prev, { id, message, tone }];
        // Cap the stack; drop the oldest (and its pending timer).
        while (next.length > MAX_TOASTS) {
          const dropped = next.shift();
          if (dropped) clearTimer(dropped.id);
        }
        return next;
      });
      if (!toastPersists(tone)) {
        const timer = setTimeout(() => dismissToast(id), AUTO_DISMISS_MS);
        timersRef.current.set(id, timer);
      }
      return id;
    },
    [clearTimer, dismissToast],
  );

  useMountEffect(() => () => {
    for (const timer of timersRef.current.values()) clearTimeout(timer);
    timersRef.current.clear();
  });

  return { toasts, showToast, dismissToast };
}
