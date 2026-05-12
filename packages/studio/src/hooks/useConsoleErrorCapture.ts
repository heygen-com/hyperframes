import { useEffect, useRef, useState } from "react";
import type { LintFinding } from "../components/LintModal";

/**
 * Captures `console.error` and `window.onerror` events from a preview iframe
 * and exposes them as LintFinding[] for the console errors modal.
 */
export function useConsoleErrorCapture(previewIframe: HTMLIFrameElement | null) {
  const [consoleErrors, setConsoleErrors] = useState<LintFinding[] | null>(null);
  const consoleErrorsRef = useRef<LintFinding[]>([]);

  const resetErrors = () => {
    consoleErrorsRef.current = [];
    setConsoleErrors(null);
  };

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!previewIframe) return;
    const attachErrorCapture = () => {
      try {
        const win = previewIframe.contentWindow as (Window & typeof globalThis) | null;
        if (!win) return;
        if ((win as unknown as Record<string, unknown>).__hfErrorCapture) return;
        (win as unknown as Record<string, unknown>).__hfErrorCapture = true;
        const origError = win.console.error.bind(win.console);
        win.console.error = function (...args: unknown[]) {
          origError(...args);
          const text = args.map((a) => (a instanceof Error ? a.message : String(a))).join(" ");
          if (text.includes("favicon")) return;
          consoleErrorsRef.current = [
            ...consoleErrorsRef.current,
            { severity: "error", message: text },
          ];
          setConsoleErrors([...consoleErrorsRef.current]);
        };
        win.addEventListener("error", (e: ErrorEvent) => {
          const text = e.message || String(e);
          consoleErrorsRef.current = [
            ...consoleErrorsRef.current,
            { severity: "error", message: text },
          ];
          setConsoleErrors([...consoleErrorsRef.current]);
        });
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
    return () => previewIframe.removeEventListener("load", handleLoad);
  }, [previewIframe]);

  return { consoleErrors, setConsoleErrors, resetErrors };
}
