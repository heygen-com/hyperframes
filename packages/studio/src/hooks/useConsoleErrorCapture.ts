import { useCallback, useEffect, useRef, useState } from "react";
import type { LintFinding } from "../components/LintModal";

/**
 * Patch a preview window's `console.error` and `error` event, and return the
 * undo.
 *
 * Module scope, not the effect body it used to live in. The React Compiler
 * refuses a hook whose nested closures reassign a binding it can see from
 * render, and `previewIframe` reached these closures straight from the hook's
 * parameters. Out here the parameter is a plain argument, and the patch state
 * lives in locals no compiled code observes.
 */
function attachErrorCapture(
  win: (Window & typeof globalThis) | null,
  onError: (message: string) => void,
): () => void {
  if (!win) return () => {};
  if ((win as unknown as Record<string, unknown>).__hfErrorCapture) return () => {};
  let origConsoleError: ((...args: unknown[]) => void) | null = null;
  let errorHandler: ((e: ErrorEvent) => void) | null = null;
  try {
    (win as unknown as Record<string, unknown>).__hfErrorCapture = true;
    origConsoleError = win.console.error.bind(win.console);
    win.console.error = function (...args: unknown[]) {
      origConsoleError?.(...args);
      const text = args.map((a) => (a instanceof Error ? a.message : String(a))).join(" ");
      if (text.includes("favicon")) return;
      onError(text);
    };
    errorHandler = (e: ErrorEvent) => onError(e.message || String(e));
    win.addEventListener("error", errorHandler);
  } catch {
    /* same-origin only */
  }
  return () => {
    try {
      if (origConsoleError) win.console.error = origConsoleError;
      if (errorHandler) win.removeEventListener("error", errorHandler);
      delete (win as unknown as Record<string, unknown>).__hfErrorCapture;
    } catch {
      /* cross-origin or destroyed window */
    }
  };
}

function previewWindow(iframe: HTMLIFrameElement): (Window & typeof globalThis) | null {
  try {
    return iframe.contentWindow as (Window & typeof globalThis) | null;
  } catch {
    return null;
  }
}

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

  const appendError = useCallback((message: string) => {
    consoleErrorsRef.current = [...consoleErrorsRef.current, { severity: "error", message }];
    setConsoleErrors([...consoleErrorsRef.current]);
  }, []);

  useEffect(() => {
    if (!previewIframe) return;
    let detach = attachErrorCapture(previewWindow(previewIframe), appendError);
    // Re-attach on every LOAD, not once on mount: a reload keeps the element and
    // the WindowProxy while replacing the inner window that holds the listeners.
    const handleLoad = () => {
      detach();
      resetErrors();
      detach = attachErrorCapture(previewWindow(previewIframe), appendError);
    };
    previewIframe.addEventListener("load", handleLoad);
    return () => {
      previewIframe.removeEventListener("load", handleLoad);
      detach();
    };
  }, [previewIframe, appendError, resetErrors]);

  return { consoleErrors, setConsoleErrors, resetErrors };
}
