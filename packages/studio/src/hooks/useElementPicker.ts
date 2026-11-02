import { useState, useCallback, useEffect, useRef } from "react";
import { useMountEffect } from "./useMountEffect";
import {
  resolveSourceFile,
  applyPatch,
  applyPatchByTarget,
  findTagByTarget,
  type PatchOperation,
} from "../utils/sourcePatcher";
import {
  acceptStudioRuntimeMessage,
  postRuntimeControlMessage,
} from "../player/lib/runtimeProtocol";
import { compositionPathOfPreviewUrl } from "../player/components/CompositionThumbnail";
import { getSourceFileForElement } from "../components/editor/domEditingDom";
import {
  createElementPickerHoverLabel,
  type ElementPickerHoverInfo,
  type ElementPickerHoverLabel,
} from "./elementPickerHoverLabel";

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

interface UseElementPickerSessionReturn extends Omit<
  UseElementPickerReturn,
  "setStyle" | "setDataAttr" | "setTextContent"
> {
  setPickedElement: React.Dispatch<React.SetStateAction<PickedElement | null>>;
  getActiveIframe: () => HTMLIFrameElement | null;
}

function usePickerHoverLabel(): {
  clearHover: () => void;
  disposeHover: () => void;
  showHover: (info: ElementPickerHoverInfo, iframe: HTMLIFrameElement) => void;
} {
  const hoverLabelRef = useRef<ElementPickerHoverLabel | null>(null);
  const clearHover = useCallback(() => hoverLabelRef.current?.clear(), []);
  const disposeHover = useCallback(() => hoverLabelRef.current?.dispose(), []);
  const showHover = useCallback((info: ElementPickerHoverInfo, iframe: HTMLIFrameElement) => {
    hoverLabelRef.current ??= createElementPickerHoverLabel();
    hoverLabelRef.current.show(info, iframe);
  }, []);
  return { clearHover, disposeHover, showHover };
}

function useActivePickerIframe(
  iframeRef: React.RefObject<HTMLIFrameElement | null>,
  isPickModeRef: React.RefObject<boolean>,
  clearHover: () => void,
): {
  activeIframeRef: React.RefObject<HTMLIFrameElement | null>;
  getActiveIframe: () => HTMLIFrameElement | null;
  setActiveIframe: (el: HTMLIFrameElement | null) => void;
} {
  const activeOverrideRef = useRef<HTMLIFrameElement | null>(null);
  const activeIframeRef = useRef<HTMLIFrameElement | null>(null);
  const lastRenderedActiveIframeRef = useRef<HTMLIFrameElement | null>(null);
  const getActiveIframe = useCallback(
    () => activeOverrideRef.current ?? iframeRef.current,
    [iframeRef],
  );
  const setActiveIframe = useCallback(
    (el: HTMLIFrameElement | null) => {
      const previous = activeOverrideRef.current ?? iframeRef.current;
      const next = el ?? iframeRef.current;
      if (previous === next) return;
      clearHover();
      if (isPickModeRef.current) postPickerControl(previous, "disable-pick-mode");
      activeOverrideRef.current = el;
      activeIframeRef.current = next;
      lastRenderedActiveIframeRef.current = next;
      if (isPickModeRef.current) postPickerControl(next, "enable-pick-mode");
    },
    [clearHover, iframeRef, isPickModeRef],
  );
  const renderedActiveIframe = getActiveIframe();
  useEffect(() => {
    const previous = lastRenderedActiveIframeRef.current;
    if (previous !== renderedActiveIframe) {
      clearHover();
      if (isPickModeRef.current) {
        postPickerControl(previous, "disable-pick-mode");
        postPickerControl(renderedActiveIframe, "enable-pick-mode");
      }
    }
    lastRenderedActiveIframeRef.current = renderedActiveIframe;
  }, [clearHover, isPickModeRef, renderedActiveIframe]);
  activeIframeRef.current = getActiveIframe();
  return { activeIframeRef, getActiveIframe, setActiveIframe };
}

function useElementPickerSession(
  iframeRef: React.RefObject<HTMLIFrameElement | null>,
): UseElementPickerSessionReturn {
  const [isPickMode, setIsPickMode] = useState(false);
  const [pickedElement, setPickedElement] = useState<PickedElement | null>(null);
  const isPickModeRef = useRef(false);
  const pickedElementRef = useRef<PickedElement | null>(null);
  pickedElementRef.current = pickedElement;
  const pickStartSelectionRef = useRef<PickedElement | null | undefined>(undefined);
  const { clearHover, disposeHover, showHover } = usePickerHoverLabel();
  const { activeIframeRef, getActiveIframe, setActiveIframe } = useActivePickerIframe(
    iframeRef,
    isPickModeRef,
    clearHover,
  );

  const enablePick = useCallback(() => {
    if (isPickModeRef.current || !postPickerControl(getActiveIframe(), "enable-pick-mode")) return;
    pickStartSelectionRef.current = pickedElementRef.current;
    isPickModeRef.current = true;
    setIsPickMode(true);
  }, [getActiveIframe]);

  const cancelPick = useCallback(
    (notifyRuntime: boolean) => {
      if (notifyRuntime) {
        postPickerControl(getActiveIframe(), "disable-pick-mode");
      }
      const selection = pickStartSelectionRef.current;
      pickStartSelectionRef.current = undefined;
      if (selection !== undefined) {
        pickedElementRef.current = selection;
        setPickedElement(selection);
      }
      isPickModeRef.current = false;
      clearHover();
      setIsPickMode(false);
    },
    [clearHover, getActiveIframe],
  );

  const disablePick = useCallback(() => cancelPick(true), [cancelPick]);

  const clearPick = useCallback(() => {
    pickedElementRef.current = null;
    setPickedElement(null);
  }, []);

  const windowsThatWerePrimary = useRef(new WeakSet<MessageEventSource>());

  useEffect(() => {
    if (!isPickMode) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        event.isComposing ||
        elementOwnsEscape(event.target)
      )
        return;
      event.preventDefault();
      disablePick();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [disablePick, isPickMode]);

  // Listen for picker messages from the iframe
  useMountEffect(() => {
    // One guard per message field, then one branch per message type.
    // fallow-ignore-next-line complexity
    const handleMessage = (e: MessageEvent) => {
      const data = e.data;
      if (data?.source !== "hf-preview") return;
      if (!acceptStudioRuntimeMessage(data)) return;
      // The primary frame, the active override, or a primary frame a reload just swapped out.
      const activeIframe = getActiveIframe();
      if (!activeIframe) return;
      if (!e.source) return;
      if (e.source === iframeRef.current?.contentWindow)
        windowsThatWerePrimary.current.add(e.source);
      else if (
        e.source !== activeIframe.contentWindow &&
        !windowsThatWerePrimary.current.has(e.source)
      )
        return;

      if (data.type === "element-hovered") {
        if (e.source !== activeIframe.contentWindow || !isPickModeRef.current) return;
        const info = toHoverInfo(data.elementInfo);
        if (info) showHover(info, activeIframe);
        return;
      }

      if (data.type === "element-picked" && data.elementInfo) {
        const next = toPickedElement(data.elementInfo, activeIframe);
        pickedElementRef.current = next;
        setPickedElement(next);
        pickStartSelectionRef.current = undefined;
        isPickModeRef.current = false;
        clearHover();
        setIsPickMode(false);
      } else if (data.type === "element-pick-candidates") {
        // Multiple candidates at click point — pick the first one
        const el = data.candidates?.[data.selectedIndex ?? 0];
        if (el) {
          const next = toPickedElement(el, activeIframe);
          pickedElementRef.current = next;
          setPickedElement(next);
        }
      }

      if (data.type === "pick-mode-cancelled") {
        cancelPick(false);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
      if (isPickModeRef.current) {
        postPickerControl(getActiveIframe(), "disable-pick-mode");
      }
      disposeHover();
    };
  });

  return {
    isPickMode,
    pickedElement,
    setPickedElement,
    getActiveIframe,
    enablePick,
    disablePick,
    clearPick,
    setActiveIframe,
    activeIframeRef,
  };
}

/** Element picking through the HyperFrame runtime's postMessage API. */
export function useElementPicker(
  iframeRef: React.RefObject<HTMLIFrameElement | null>,
  options?: PickerOptions,
): UseElementPickerReturn {
  const {
    isPickMode,
    pickedElement,
    setPickedElement,
    getActiveIframe,
    enablePick,
    disablePick,
    clearPick,
    setActiveIframe,
    activeIframeRef,
  } = useElementPickerSession(iframeRef);

  const optionsRef = useRef(options);
  optionsRef.current = options;
  const pendingWritesRef = useRef(new Map<string, PendingWrite>());
  settlePendingWrites(pendingWritesRef.current, options?.workspaceFiles);

  const syncToSource = useCallback(
    (picked: PickedElement, live: HTMLElement, iframe: HTMLIFrameElement, op: PatchOperation) => {
      const opts = optionsRef.current;
      if (!opts?.workspaceFiles || !opts.onSyncFiles) return;
      // No id: the preview's hf-id names the element, in the file it was served from.
      const hfId = live.getAttribute("data-hf-id");
      const pending = pendingWritesRef.current;
      const files = withPendingWrites(opts.workspaceFiles, pending);
      const patch = picked.id
        ? patchById(files, picked.id, picked.selector, op)
        : hfId
          ? patchByHfId(files, hfId, ownSourceFile(live, iframe), op)
          : null;
      if (!patch || patch.after === patch.before) return;
      recordPendingWrite(pending, patch.path, opts.workspaceFiles[patch.path], patch.after);
      opts.onSyncFiles({ [patch.path]: patch.after });
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
          syncToSource(pickedElement, el, activeIframe, {
            type: "inline-style",
            property: prop,
            value,
          });
        }
      } catch {
        /* cross-origin */
      }
    },
    [pickedElement, getActiveIframe, setPickedElement, syncToSource],
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
          syncToSource(pickedElement, el as HTMLElement, activeIframe, {
            type: "attribute",
            property: attr,
            value,
          });
        }
      } catch {
        /* cross-origin */
      }
    },
    [pickedElement, getActiveIframe, setPickedElement, syncToSource],
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
          syncToSource(pickedElement, el as HTMLElement, activeIframe, {
            type: "text-content",
            property: "textContent",
            value: text,
          });
        }
      } catch {
        /* cross-origin */
      }
    },
    [pickedElement, getActiveIframe, setPickedElement, syncToSource],
  );

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

function elementOwnsEscape(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      'dialog,[role="dialog"],[aria-modal="true"],input,textarea,select,[contenteditable="true"],[contenteditable=""],[data-studio-escape-owner]',
    ),
  );
}

function postPickerControl(
  iframe: HTMLIFrameElement | null | undefined,
  action: "enable-pick-mode" | "disable-pick-mode",
): boolean {
  try {
    postRuntimeControlMessage(iframe?.contentWindow, action);
    return true;
  } catch {
    return false;
  }
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isOptionalString(value: unknown): value is string | null | undefined {
  return value === null || value === undefined || typeof value === "string";
}

function toHoverInfo(value: unknown): ElementPickerHoverInfo | null {
  if (!isUnknownRecord(value)) return null;
  const info = value;
  const box = info.boundingBox;
  if (typeof info.tagName !== "string" || !isUnknownRecord(box)) return null;
  const coordinates = [box.x, box.y, box.width, box.height];
  if (!coordinates.every(isFiniteNumber)) return null;
  const [x, y, width, height] = coordinates as [number, number, number, number];
  if (!isOptionalString(info.id) || !isOptionalString(info.className)) return null;
  return {
    id: typeof info.id === "string" ? info.id : null,
    className: typeof info.className === "string" ? info.className : null,
    tagName: info.tagName,
    boundingBox: { x, y, width, height },
  };
}

type PickedElementInfo = Partial<Omit<PickedElement, "computedStyles">>;

// workspaceFiles lags this hook's own writes until the host rerenders.
interface PendingWrite {
  hostSource: string | undefined;
  writes: string[];
}

function settlePendingWrites(
  pending: Map<string, PendingWrite>,
  files: Record<string, string> | undefined,
): void {
  for (const [path, write] of pending) {
    const hostSource = files?.[path];
    if (hostSource === write.hostSource) continue;
    const caughtUpTo = hostSource === undefined ? -1 : write.writes.indexOf(hostSource);
    if (caughtUpTo < 0 || caughtUpTo === write.writes.length - 1) {
      pending.delete(path);
    } else {
      write.hostSource = hostSource;
      write.writes = write.writes.slice(caughtUpTo + 1);
    }
  }
}

function withPendingWrites(
  files: Record<string, string>,
  pending: Map<string, PendingWrite>,
): Record<string, string> {
  const merged = { ...files };
  for (const [path, write] of pending) merged[path] = write.writes.at(-1) ?? merged[path];
  return merged;
}

function recordPendingWrite(
  pending: Map<string, PendingWrite>,
  path: string,
  hostSource: string | undefined,
  after: string,
): void {
  const write = pending.get(path) ?? { hostSource, writes: [] };
  write.writes.push(after);
  pending.set(path, write);
}

// A default per field of the runtime's element info.
// fallow-ignore-next-line complexity
function toPickedElement(el: PickedElementInfo, iframe: HTMLIFrameElement): PickedElement {
  return {
    id: el.id ?? null,
    tagName: el.tagName ?? "div",
    selector: el.selector ?? "",
    label: el.label ?? el.tagName ?? "Element",
    boundingBox: el.boundingBox ?? { x: 0, y: 0, width: 0, height: 0 },
    textContent: el.textContent ?? null,
    src: el.src ?? null,
    dataAttributes: el.dataAttributes ?? {},
    computedStyles: readComputedStyles(iframe, el.selector ?? ""),
  };
}

interface SourcePatch {
  path: string;
  before: string;
  after: string;
}

function patchById(
  files: Record<string, string>,
  id: string,
  selector: string,
  op: PatchOperation,
): SourcePatch | null {
  const path = resolveSourceFile(id, selector, files);
  const before = path ? files[path] : undefined;
  return path && before ? { path, before, after: applyPatch(before, id, op) } : null;
}

function ownSourceFile(live: HTMLElement, iframe: HTMLIFrameElement): string {
  const previewed = compositionPathOfPreviewUrl(iframe.getAttribute("src") ?? "");
  return getSourceFileForElement(live, previewed).sourceFile;
}

function patchByHfId(
  files: Record<string, string>,
  hfId: string,
  ownFile: string,
  op: PatchOperation,
): SourcePatch | null {
  const matches = Object.keys(files).filter((file) => findTagByTarget(files[file] ?? "", { hfId }));
  const path = matches.includes(ownFile) ? ownFile : matches.length === 1 ? matches[0] : undefined;
  const before = path ? files[path] : undefined;
  return path && before ? { path, before, after: applyPatchByTarget(before, { hfId }, op) } : null;
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
