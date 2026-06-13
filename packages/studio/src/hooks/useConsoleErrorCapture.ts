import { useCallback, useEffect, useRef, useState } from "react";
import type { LintFinding } from "../components/LintModal";

/**
 * Captures `console.error` and `window.onerror` events from a preview iframe
 * and exposes them as LintFinding[] for the console errors modal.
 */
export function useConsoleErrorCapture(previewIframe: HTMLIFrameElement | null) {
  const [consoleErrors, setConsoleErrors] = useState<LintFinding[] | null>(null);
  const consoleErrorsRef = useRef<LintFinding[]>([]);

  const resetErrors = useCallback(() => {
    consoleErrorsRef.current = [];
    setConsoleErrors(null);
  }, []);

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!previewIframe) return;

    let patchedWin: (Window & typeof globalThis) | null = null;
    let origConsoleError: ((...args: unknown[]) => void) | null = null;
    let errorHandler: ((e: ErrorEvent) => void) | null = null;

    const detachErrorCapture = () => {
      const win = patchedWin;
      if (!win) return;
      patchedWin = null;
      try {
        // origConsoleError and errorHandler are always set alongside patchedWin
        win.console.error = origConsoleError!;
        win.removeEventListener("error", errorHandler!);
        delete (win as unknown as Record<string, unknown>).__hfErrorCapture;
      } catch {
        /* cross-origin or destroyed window */
      }
      origConsoleError = null;
      errorHandler = null;
    };

    const attachErrorCapture = () => {
      detachErrorCapture();
      try {
        const win = previewIframe.contentWindow as (Window & typeof globalThis) | null;
        if (!win) return;
        if ((win as unknown as Record<string, unknown>).__hfErrorCapture) return;
        (win as unknown as Record<string, unknown>).__hfErrorCapture = true;
        patchedWin = win;
        origConsoleError = win.console.error.bind(win.console);
        win.console.error = function (...args: unknown[]) {
          origConsoleError!(...args);
          const text = args.map((a) => (a instanceof Error ? a.message : String(a))).join(" ");
          if (text.includes("favicon")) return;
          consoleErrorsRef.current = [
            ...consoleErrorsRef.current,
            { severity: "error", message: text },
          ];
          setConsoleErrors([...consoleErrorsRef.current]);
        };
        errorHandler = (e: ErrorEvent) => {
          const text = e.message || String(e);
          consoleErrorsRef.current = [
            ...consoleErrorsRef.current,
            { severity: "error", message: text },
          ];
          setConsoleErrors([...consoleErrorsRef.current]);
        };
        win.addEventListener("error", errorHandler);
      } catch {
        /* same-origin only */
      }
    };

    attachErrorCapture();
    const handleLoad = () => {
      consoleErrorsRef.current = [];
      setConsoleErrors(null);
      attachErrorCapture();
    };
    previewIframe.addEventListener("load", handleLoad);
    return () => {
      previewIframe.removeEventListener("load", handleLoad);
      detachErrorCapture();
    };
  }, [previewIframe]);

  return { consoleErrors, setConsoleErrors, resetErrors };
}
