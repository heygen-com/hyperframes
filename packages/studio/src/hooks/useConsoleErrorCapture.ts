import { useCallback, useEffect, useRef, useState } from "react";
import {
  previewConsoleErrorText,
  STUDIO_PREVIEW_ERRORS,
} from "@hyperframes/core/studio-preview-mark";
import { onPreviewDocumentLoaded } from "../player/sceneSwap";
import { previewConsoleErrors, previewFrameOpaque } from "../player/lib/previewChannel";
import type { LintFinding } from "../components/LintModal";

const SEALED_POLL_MS = 1_000;

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
    resetErrors();
    if (!previewIframe) return;

    let patchedWin: (Window & typeof globalThis) | null = null;
    let origConsoleError: ((...args: unknown[]) => void) | null = null;
    let errorHandler: ((e: ErrorEvent) => void) | null = null;
    let stopSealedReads: (() => void) | null = null;

    const record = (texts: readonly string[]) => {
      if (texts.length === 0) return;
      consoleErrorsRef.current = [
        ...consoleErrorsRef.current,
        ...texts.map((message) => ({ severity: "error" as const, message })),
      ];
      setConsoleErrors([...consoleErrorsRef.current]);
    };

    const readSealedErrors = (iframe: HTMLIFrameElement) => {
      let live = true;
      let read = 0;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const poll = async () => {
        for (;;) {
          const page = await previewConsoleErrors(iframe, read);
          if (!live) return;
          if (!page) break;
          read += page.errors.length;
          record(page.errors);
          if (!page.truncated || page.errors.length === 0) break;
        }
        timer = setTimeout(poll, SEALED_POLL_MS);
      };
      void poll();
      return () => {
        live = false;
        clearTimeout(timer);
      };
    };

    const detachErrorCapture = () => {
      stopSealedReads?.();
      stopSealedReads = null;
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
      resetErrors();
      if (previewFrameOpaque(previewIframe)) {
        stopSealedReads = readSealedErrors(previewIframe);
        return;
      }
      try {
        const win = previewIframe.contentWindow as (Window & typeof globalThis) | null;
        if (!win) return;
        if ((win as unknown as Record<string, unknown>).__hfErrorCapture) return;
        (win as unknown as Record<string, unknown>).__hfErrorCapture = true;
        patchedWin = win;
        origConsoleError = win.console.error.bind(win.console);
        win.console.error = function (...args: unknown[]) {
          origConsoleError!(...args);
          const text = previewConsoleErrorText(args);
          if (text !== null) record([text]);
        };
        errorHandler = (e: ErrorEvent) => record([e.message || String(e)]);
        win.addEventListener("error", errorHandler);
        const raised: unknown = Reflect.get(win, STUDIO_PREVIEW_ERRORS);
        if (Array.isArray(raised)) record(raised.map(String));
      } catch {
        /* same-origin only */
      }
    };

    attachErrorCapture();
    const stopLoaded = onPreviewDocumentLoaded(previewIframe, attachErrorCapture);
    return () => {
      stopLoaded();
      detachErrorCapture();
    };
  }, [previewIframe, resetErrors]);

  return { consoleErrors, setConsoleErrors };
}
