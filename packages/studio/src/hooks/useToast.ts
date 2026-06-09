import { useState, useCallback, useRef } from "react";
import { useMountEffect } from "./useMountEffect";
import type { AppToast } from "../utils/studioHelpers";

export function useToast() {
  const [appToast, setAppToast] = useState<AppToast | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, tone: AppToast["tone"] = "error") => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setAppToast({ message, tone });
    timerRef.current = setTimeout(() => setAppToast(null), 4000);
  }, []);

  useMountEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  });

  const dismissToast = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setAppToast(null);
  }, []);

  return { appToast, showToast, dismissToast };
}
