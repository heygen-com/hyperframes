import { useEffect } from "react";
import type { DomEditSelection } from "../components/editor/domEditing";

interface StudioTestHookDeps {
  previewIframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  buildDomSelectionFromTarget: (target: HTMLElement) => Promise<DomEditSelection | null>;
  applyDomSelection: (
    selection: DomEditSelection | null,
    options?: { revealPanel?: boolean },
  ) => void;
}

interface StudioTestApi {
  selectByDomId: (id: string) => Promise<boolean>;
}

declare global {
  interface Window {
    __studioTest?: StudioTestApi;
  }
}

/**
 * Dev-only headless-QA shortcut. Selecting an element normally requires a
 * pixel-precise click inside the preview iframe, which automated verification
 * can't reliably land. `window.__studioTest.selectByDomId(id)` resolves the
 * DomEditSelection for a preview element by id and reveals the inspector —
 * exactly what a click does — so a driver can open the property/ease panels and
 * then focus a segment via `__playerStore.getState().setFocusedEaseSegment`.
 * No-op in production builds.
 */
export function useStudioTestHooks({
  previewIframeRef,
  buildDomSelectionFromTarget,
  applyDomSelection,
}: StudioTestHookDeps): void {
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    let isDev = false;
    try {
      isDev = import.meta.env.DEV === true;
    } catch {
      isDev = false;
    }
    if (!isDev || typeof window === "undefined") return;
    const api: StudioTestApi = {
      selectByDomId: async (id: string): Promise<boolean> => {
        const element = previewIframeRef.current?.contentDocument?.getElementById(id) ?? null;
        if (!element) return false;
        const selection = await buildDomSelectionFromTarget(element);
        if (!selection) return false;
        applyDomSelection(selection, { revealPanel: true });
        return true;
      },
    };
    window.__studioTest = api;
    return () => {
      window.__studioTest = undefined;
    };
  }, [applyDomSelection, buildDomSelectionFromTarget, previewIframeRef]);
}
