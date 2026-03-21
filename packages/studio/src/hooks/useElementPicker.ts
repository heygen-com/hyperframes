import { useState, useCallback, useRef } from "react";
import { useMountEffect } from "./useMountEffect";
import { resolveSourceFile, applyPatch } from "../utils/sourcePatcher";

export interface PickedElement {
  id: string | null;
  tagName: string;
  selector: string;
  label: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  textContent: string | null;
  src: string | null;
  dataAttributes: Record<string, string>;
  computedStyles: Record<string, string>;
}

interface UseElementPickerReturn {
  isPickMode: boolean;
  pickedElement: PickedElement | null;
  enablePick: () => void;
  disablePick: () => void;
  clearPick: () => void;
  /** Update a CSS property on the picked element live + persist to source */
  setStyle: (prop: string, value: string) => void;
  /** Update a data attribute on the picked element + persist to source */
  setDataAttr: (attr: string, value: string) => void;
  /** Update the text content of the picked element + persist to source */
  setTextContent: (text: string) => void;
  /** Override the active iframe (for zoomed canvas view). Pass null to restore primary. */
  setActiveIframe: (el: HTMLIFrameElement | null) => void;
  /** Ref that always points to the active iframe (focused canvas frame or preview panel) */
  activeIframeRef: React.RefObject<HTMLIFrameElement | null>;
}

interface PickerOptions {
  /** Workspace files for source patching */
  workspaceFiles?: Record<string, string>;
  /** Callback to sync patched files to the project */
  onSyncFiles?: (files: Record<string, string>) => void;
}

/**
 * Hook for element picking via the HyperFrame runtime's picker API.
 * Communicates with the iframe via postMessage.
 */
export function useElementPicker(
  iframeRef: React.RefObject<HTMLIFrameElement | null>,
  options?: PickerOptions,
): UseElementPickerReturn {
  const [isPickMode, setIsPickMode] = useState(false);
  const [pickedElement, setPickedElement] = useState<PickedElement | null>(null);

  // Secondary/override iframe ref — set when a zoomed frame is active.
  // When set, all postMessage sends and DOM reads go to this ref instead.
  const activeOverrideRef = useRef<HTMLIFrameElement | null>(null);

  const getActiveIframe = useCallback((): HTMLIFrameElement | null => {
    return activeOverrideRef.current ?? iframeRef.current;
  }, [iframeRef]);

  // Exposed so the host page can wire the focused view's iframe into the picker
  const setActiveIframe = useCallback((el: HTMLIFrameElement | null) => {
    activeOverrideRef.current = el;
  }, []);

  const enablePick = useCallback(() => {
    try {
      getActiveIframe()?.contentWindow?.postMessage(
        { source: "hf-parent", type: "control", action: "enable-pick-mode" },
        "*",
      );
      setIsPickMode(true);
    } catch {
      /* cross-origin */
    }
  }, [getActiveIframe]);

  const disablePick = useCallback(() => {
    try {
      getActiveIframe()?.contentWindow?.postMessage(
        { source: "hf-parent", type: "control", action: "disable-pick-mode" },
        "*",
      );
    } catch {
      /* cross-origin */
    }
    setIsPickMode(false);
  }, [getActiveIframe]);

  const clearPick = useCallback(() => {
    setPickedElement(null);
  }, []);

  // Listen for picker messages from the iframe
  useMountEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      const data = e.data;
      if (data?.source !== "hf-preview") return;
      // Accept events from either the primary iframe or the active override
      const activeIframe = getActiveIframe();
      if (!activeIframe) return;
      if (e.source !== activeIframe.contentWindow && e.source !== iframeRef.current?.contentWindow) return;

      if (data.type === "element-picked") {
        const el = data.elementInfo;
        if (el) {
          const styles = readComputedStyles(activeIframe, el.selector);
          setPickedElement({
            id: el.id ?? null,
            tagName: el.tagName ?? "div",
            selector: el.selector ?? "",
            label: el.label ?? el.tagName ?? "Element",
            boundingBox: el.boundingBox ?? { x: 0, y: 0, width: 0, height: 0 },
            textContent: el.textContent ?? null,
            src: el.src ?? null,
            dataAttributes: el.dataAttributes ?? {},
            computedStyles: styles,
          });
          setIsPickMode(false);
        }
      } else if (data.type === "element-pick-candidates") {
        // Multiple candidates at click point — pick the first one
        const el = data.candidates?.[data.selectedIndex ?? 0];
        if (el) {
          const styles = readComputedStyles(activeIframe, el.selector);
          setPickedElement({
            id: el.id ?? null,
            tagName: el.tagName ?? "div",
            selector: el.selector ?? "",
            label: el.label ?? el.tagName ?? "Element",
            boundingBox: el.boundingBox ?? { x: 0, y: 0, width: 0, height: 0 },
            textContent: el.textContent ?? null,
            src: el.src ?? null,
            dataAttributes: el.dataAttributes ?? {},
            computedStyles: styles,
          });
        }
      }

      if (data.type === "pick-mode-cancelled") {
        setIsPickMode(false);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  });

  // Ref for options to avoid stale closures in debounced callback
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Sync immediately (not debounced) — save on every change for reliability
  const syncToSource = useCallback(
    (
      elementId: string,
      selector: string,
      op: { type: "inline-style" | "attribute" | "text-content"; property: string; value: string },
    ) => {
      const opts = optionsRef.current;
      if (!opts?.workspaceFiles || !opts.onSyncFiles || !elementId) return;
      const files = opts.workspaceFiles;
      const sourceFile = resolveSourceFile(elementId, selector, files);
      if (!sourceFile || !files[sourceFile]) {
        return;
      }
      const patched = applyPatch(files[sourceFile], elementId, op);
      if (patched !== files[sourceFile]) {
        opts.onSyncFiles({ [sourceFile]: patched });
      }
    },
    [],
  );

  const setStyle = useCallback(
    (prop: string, value: string) => {
      const activeIframe = getActiveIframe();
      if (!pickedElement?.selector || !activeIframe) return;
      try {
        const doc = activeIframe.contentDocument;
        const el = doc?.querySelector(pickedElement.selector) as HTMLElement | null;
        if (el) {
          el.style.setProperty(prop, value);
          setPickedElement((prev) =>
            prev
              ? {
                  ...prev,
                  computedStyles: { ...prev.computedStyles, [prop]: value },
                }
              : null,
          );
          // Persist to source file
          if (pickedElement.id) {
            // ID-based patching — surgical edit of just the element's style
            syncToSource(pickedElement.id, pickedElement.selector, { type: "inline-style", property: prop, value });
          } else {
            // No ID — save the full composition HTML from the iframe
            // This captures ALL inline style changes, not just the targeted one
            try {
              const fullHtml = activeIframe.contentDocument?.documentElement.outerHTML;
              if (fullHtml && optionsRef.current?.onSyncFiles) {
                // Determine which file this iframe represents
                const src = activeIframe.getAttribute("src") ?? "";
                const compMatch = src.match(/\/comp\/(.+?)(?:\?|$)/);
                const filePath = compMatch ? compMatch[1] : "index.html";
                optionsRef.current.onSyncFiles({ [filePath]: `<!DOCTYPE html>\n<html>${fullHtml.replace(/<html[^>]*>/, "")}`  });
              }
            } catch { /* cross-origin */ }
          }
        }
      } catch {
        /* cross-origin */
      }
    },
    [pickedElement, getActiveIframe, syncToSource],
  );

  const setDataAttr = useCallback(
    (attr: string, value: string) => {
      const activeIframe = getActiveIframe();
      if (!pickedElement?.selector || !activeIframe) return;
      try {
        const doc = activeIframe.contentDocument;
        const el = doc?.querySelector(pickedElement.selector);
        if (el) {
          el.setAttribute(`data-${attr}`, value);
          setPickedElement((prev) =>
            prev
              ? {
                  ...prev,
                  dataAttributes: { ...prev.dataAttributes, [attr]: value },
                }
              : null,
          );
          // Persist to source file immediately
          if (pickedElement.id) {
            syncToSource(pickedElement.id, pickedElement.selector, { type: "attribute", property: attr, value });
          }
        }
      } catch {
        /* cross-origin */
      }
    },
    [pickedElement, getActiveIframe, syncToSource],
  );

  const setTextContent = useCallback(
    (text: string) => {
      const activeIframe = getActiveIframe();
      if (!pickedElement?.selector || !activeIframe) return;
      try {
        const doc = activeIframe.contentDocument;
        const el = doc?.querySelector(pickedElement.selector);
        if (el) {
          el.textContent = text;
          setPickedElement((prev) => (prev ? { ...prev, textContent: text } : null));
          // Persist to source file
          if (pickedElement.id) {
            syncToSource(pickedElement.id, pickedElement.selector, {
              type: "text-content",
              property: "textContent",
              value: text,
            });
          }
        }
      } catch {
        /* cross-origin */
      }
    },
    [pickedElement, getActiveIframe, syncToSource],
  );

  // Ref-like object that always points to the active iframe (override or primary)
  const activeIframeRef = useRef<HTMLIFrameElement | null>(null);
  activeIframeRef.current = getActiveIframe();

  return {
    isPickMode,
    pickedElement,
    enablePick,
    disablePick,
    clearPick,
    setStyle,
    setDataAttr,
    setTextContent,
    setActiveIframe,
    /** Ref that always points to the active iframe (focused canvas frame or preview panel) */
    activeIframeRef,
  };
}

/** Read a subset of computed styles from an element in the iframe */
function readComputedStyles(iframe: HTMLIFrameElement, selector: string): Record<string, string> {
  const styles: Record<string, string> = {};
  try {
    const doc = iframe.contentDocument;
    const el = doc?.querySelector(selector);
    if (!el) return styles;
    const computed = iframe.contentWindow?.getComputedStyle(el);
    if (!computed) return styles;

    const props = [
      "position",
      "top",
      "left",
      "right",
      "bottom",
      "width",
      "height",
      "margin-top",
      "margin-right",
      "margin-bottom",
      "margin-left",
      "padding-top",
      "padding-right",
      "padding-bottom",
      "padding-left",
      "font-size",
      "font-weight",
      "font-family",
      "color",
      "background-color",
      "background",
      "opacity",
      "border-radius",
      "transform",
      "z-index",
    ];

    for (const prop of props) {
      const val = computed.getPropertyValue(prop);
      if (val) styles[prop] = val;
    }
  } catch {
    /* cross-origin */
  }
  return styles;
}
