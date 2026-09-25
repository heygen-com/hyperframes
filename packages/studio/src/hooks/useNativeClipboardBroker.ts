import { useCallback, useEffect, useRef } from "react";
import { usePlayerStore } from "../player";
import { isEditableTarget } from "../utils/timelineDiscovery";

type NativeClipboardAction = "copy" | "cut" | "paste";

interface NativeClipboardHandlers {
  copy: (event: ClipboardEvent) => void;
  cut: (event: ClipboardEvent) => void;
  paste: (event: ClipboardEvent) => void;
}

interface UseNativeClipboardBrokerOptions {
  handlers: NativeClipboardHandlers;
}

function shouldBrokerNativeClipboardEvent(target: EventTarget | null): boolean {
  return !isEditableTarget(target) && usePlayerStore.getState().automationSelection === null;
}

function contentWindow(iframe: HTMLIFrameElement | null): Window | null {
  try {
    return iframe?.contentWindow ?? null;
  } catch {
    return null;
  }
}

/**
 * Own native clipboard freshness for Studio and its same-origin preview.
 *
 * The broker never reads the ambient clipboard. It forwards only the bytes
 * Chrome attached to the user-triggered ClipboardEvent, while editors and an
 * active automation range keep their existing native owners.
 */
export function useNativeClipboardBroker({ handlers }: UseNativeClipboardBrokerOptions) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const previewCleanupRef = useRef<(() => void) | null>(null);

  const dispatch = useCallback((event: ClipboardEvent) => {
    if (!shouldBrokerNativeClipboardEvent(event.target)) return;
    const action = event.type as NativeClipboardAction;
    handlersRef.current[action](event);
  }, []);

  useEffect(() => {
    window.addEventListener("copy", dispatch, true);
    window.addEventListener("cut", dispatch, true);
    window.addEventListener("paste", dispatch, true);
    return () => {
      window.removeEventListener("copy", dispatch, true);
      window.removeEventListener("cut", dispatch, true);
      window.removeEventListener("paste", dispatch, true);
    };
  }, [dispatch]);

  const syncPreviewClipboard = useCallback(
    (iframe: HTMLIFrameElement | null) => {
      previewCleanupRef.current?.();
      previewCleanupRef.current = null;
      const target = contentWindow(iframe);
      if (!target) return;
      target.addEventListener("copy", dispatch, true);
      target.addEventListener("cut", dispatch, true);
      target.addEventListener("paste", dispatch, true);
      previewCleanupRef.current = () => {
        target.removeEventListener("copy", dispatch, true);
        target.removeEventListener("cut", dispatch, true);
        target.removeEventListener("paste", dispatch, true);
      };
    },
    [dispatch],
  );

  useEffect(
    () => () => {
      previewCleanupRef.current?.();
      previewCleanupRef.current = null;
    },
    [],
  );

  return { syncPreviewClipboard };
}
