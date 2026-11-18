import { useLivePreviewIframe } from "../player/store/previewIframeStore";
import { buildProjectApiPath } from "../utils/projectRouting";
import { useEffect, useRef } from "react";
import { useCaptionStore } from "../captions/store";
import { acceptStudioRuntimeMessage } from "../player/lib/runtimeProtocol";
import { useCaptionSync } from "../captions/hooks/useCaptionSync";
import { parseCaptionComposition } from "../captions/parser";
import type { CaptionModel } from "../captions/types";
import { studioApiFetch } from "../utils/studioApiFetch";
import { MAX_DESCRIBE_HANDLES } from "@hyperframes/core/runtime/editing-port";
import { previewComputedStyles, previewFrameOpaque } from "../player/lib/previewChannel";
import {
  describePreviewElements,
  previewAncestors,
  queryPreviewElements,
  type PreviewElement,
} from "../player/lib/previewElements";

interface UseCaptionDetectionParams {
  projectId: string | null;
  activeCompPath: string | null;
  compIdToSrc: Map<string, string>;
  captionEditMode: boolean;
  captionHasSelection: boolean;
  previewIframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  captionSync: ReturnType<typeof useCaptionSync>;
  setRightCollapsed: (collapsed: boolean) => void;
}

// The parser's GROUP_SELECTOR and WORD_SELECTOR, the elements it reads.
const GROUP_SELECTOR = ".caption-group, .caption-line, .caption-block";
const WORD_SELECTOR = ".word, .caption-word";

const attribute = (el: PreviewElement | null | undefined, name: string) =>
  el?.attributes.find(([key]) => key === name)?.[1] ?? null;

/** The styles `parseCaptionComposition` reads off its first word and group. */
const CAPTION_STYLES = [
  "font-size",
  "font-weight",
  "font-family",
  "color",
  "text-transform",
  "letter-spacing",
  "background-color",
  "border-radius",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
];

async function frameStyles(iframe: HTMLIFrameElement, handle: string | undefined) {
  if (!handle) return null;
  const styles = await previewComputedStyles(iframe, { handle }, CAPTION_STYLES);
  if (!styles) return null;
  const camel = (name: string) => name.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
  return Object.fromEntries(CAPTION_STYLES.map((name) => [camel(name), styles[name] ?? ""]));
}

/** A frame's caption groups and words rebuilt in order in a detached document, with a stand-in
 * `getComputedStyle` for the parser; null past one query's matches or with no answer. */
async function frameCaptionDom(
  iframe: HTMLIFrameElement,
): Promise<{ doc: Document; win: Window } | null> {
  const [all, groups, words] = await Promise.all(
    [`${GROUP_SELECTOR}, ${WORD_SELECTOR}`, GROUP_SELECTOR, WORD_SELECTOR].map((selector) =>
      queryPreviewElements(iframe, selector),
    ),
  );
  if (!all || !groups || !words || all.truncated) return null;
  const handles = all.matches.map((match) => match.handle);
  const chains: Array<string[] | null> = [];
  for (let i = 0; i < handles.length; i += MAX_DESCRIBE_HANDLES) {
    const part = await previewAncestors(iframe, handles.slice(i, i + MAX_DESCRIBE_HANDLES));
    if (!part) return null;
    chains.push(...part);
  }
  const isGroup = new Set(groups.matches.map((match) => match.handle));
  const isWord = new Set(words.matches.map((match) => match.handle));
  const doc = document.implementation.createHTMLDocument("");
  const mirrored = new Map<string, Element>();
  handles.forEach((handle, i) => {
    const el = doc.createElement("span");
    if (isGroup.has(handle)) el.classList.add("caption-group");
    if (isWord.has(handle)) el.classList.add("word");
    const parent = chains[i]?.find((ancestor) => mirrored.has(ancestor));
    (parent ? mirrored.get(parent)! : doc.body).append(el);
    mirrored.set(handle, el);
  });
  const firstWord = words.matches[0]?.handle;
  const firstGroup = groups.matches[0]?.handle;
  const styles = new Map<Element | undefined, Record<string, string> | null>([
    [mirrored.get(firstWord ?? ""), await frameStyles(iframe, firstWord)],
    [mirrored.get(firstGroup ?? ""), await frameStyles(iframe, firstGroup)],
  ]);
  const win = { getComputedStyle: (el: Element) => styles.get(el) ?? {} } as unknown as Window;
  return { doc, win };
}

async function frameCaptionModel(
  iframe: HTMLIFrameElement,
  content: string,
): Promise<CaptionModel | null> {
  const [root] = (await queryPreviewElements(iframe, "[data-composition-id]"))?.matches ?? [];
  const rootEl = root ? (await describePreviewElements(iframe, [root.handle]))?.[0] : null;
  const frame = await frameCaptionDom(iframe);
  if (!frame) return null;
  const w = parseInt(attribute(rootEl, "data-width") ?? "1920", 10);
  const h = parseInt(attribute(rootEl, "data-height") ?? "1080", 10);
  const dur = parseFloat(attribute(rootEl, "data-duration") ?? "0");
  return parseCaptionComposition(frame.doc, frame.win, content, w, h, dur);
}

export function useCaptionDetection({
  projectId,
  activeCompPath,
  compIdToSrc,
  captionEditMode,
  captionHasSelection,
  previewIframeRef,
  captionSync,
  setRightCollapsed,
}: UseCaptionDetectionParams) {
  const livePreviewIframe = useLivePreviewIframe();
  // Switching compositions must drop the previous comp's caption state — a
  // stale model + full-canvas overlay otherwise blocks normal element editing
  // on the new composition (and edit mode could never be exited).
  const prevCompPathRef = useRef<string | null>(activeCompPath);
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (prevCompPathRef.current !== activeCompPath) {
      prevCompPathRef.current = activeCompPath;
      const store = useCaptionStore.getState();
      if (store.model || store.isEditMode) {
        // Flush the last debounced caption edit before the reset destroys the
        // model — otherwise a save landing after the switch writes nothing.
        store.retrySave?.();
        store.reset();
      }
    }
  }, [activeCompPath]);

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!projectId) return;

    let activating = false;
    // A detection still in flight when the composition changes must not enter edit mode for the old one.
    let disposed = false;

    const pickCaptionSource = (hostSrcs: Array<string | null>, captionCompId: string | null) => {
      const host = hostSrcs.find((src) => src && src.includes("captions"));
      if (host) return host;
      for (const [id, src] of compIdToSrc) {
        if (id.includes("caption") || src.includes("caption")) return src;
      }
      if (activeCompPath?.includes("captions")) return activeCompPath;
      return captionCompId === null ? null : compIdToSrc.get(captionCompId) || null;
    };

    const loadCaptions = (
      srcPath: string,
      parse: (content: string) => Promise<CaptionModel | null>,
    ) =>
      studioApiFetch(buildProjectApiPath(projectId, `/files/${encodeURIComponent(srcPath)}`))
        .then((r) => r.json())
        .then(async (data: { content?: string }) => {
          if (disposed || !data.content || useCaptionStore.getState().isEditMode) return;
          const model = await parse(data.content);
          if (disposed || !model || useCaptionStore.getState().isEditMode) return;
          const store = useCaptionStore.getState();
          store.setModel(model);
          store.setSourceFilePath(srcPath);
          store.setEditMode(true);
          captionSync.loadOverrides();
        })
        .catch(() => {});

    const frameCaptionSource = async (iframe: HTMLIFrameElement) => {
      if (!(await queryPreviewElements(iframe, ".caption-group"))?.matches.length) return null;
      const hosts = await queryPreviewElements(
        iframe,
        "[data-composition-src], [data-composition-file]",
      );
      const handles = (hosts?.matches ?? []).slice(0, MAX_DESCRIBE_HANDLES).map((m) => m.handle);
      const described = handles.length ? await describePreviewElements(iframe, handles) : [];
      const hostSrcs = (described ?? []).map(
        (el) => attribute(el, "data-composition-src") || attribute(el, "data-composition-file"),
      );
      const captionComp = await queryPreviewElements(iframe, '[data-composition-id*="caption"]');
      return pickCaptionSource(hostSrcs, captionComp?.matches[0]?.source.compositionId ?? null);
    };

    const tryActivateCaptions = () => {
      const captionState = useCaptionStore.getState();
      // `dismissed` = user explicitly exited caption editing; don't re-trap them.
      if (captionState.isEditMode || captionState.dismissed || activating) {
        return;
      }

      const iframe = previewIframeRef.current;
      if (iframe && previewFrameOpaque(iframe)) {
        activating = true;
        void frameCaptionSource(iframe)
          .then((src) =>
            src && !disposed
              ? loadCaptions(src, (content) => frameCaptionModel(iframe, content))
              : null,
          )
          .finally(() => {
            activating = false;
          });
        return;
      }
      let doc: Document | null = null;
      let win: Window | null = null;
      try {
        doc = iframe?.contentDocument ?? null;
        win = iframe?.contentWindow ?? null;
      } catch {
        return;
      }
      if (!doc || !win) return;

      const groups = doc.querySelectorAll(".caption-group");
      if (groups.length === 0) return;

      const hostSrcs = [
        ...doc.querySelectorAll("[data-composition-src], [data-composition-file]"),
      ].map(
        (host) =>
          host.getAttribute("data-composition-src") || host.getAttribute("data-composition-file"),
      );
      const captionComp = doc.querySelector('[data-composition-id*="caption"]');
      const captionCompId = captionComp
        ? captionComp.getAttribute("data-composition-id") || ""
        : null;
      const captionSrcPath = pickCaptionSource(hostSrcs, captionCompId);
      if (!captionSrcPath) return;

      activating = true;
      const frameDoc = doc;
      const frameWin = win;
      void loadCaptions(captionSrcPath, async (content) => {
        const root = frameDoc.querySelector("[data-composition-id]");
        const w = parseInt(root?.getAttribute("data-width") ?? "1920", 10);
        const h = parseInt(root?.getAttribute("data-height") ?? "1080", 10);
        const dur = parseFloat(root?.getAttribute("data-duration") ?? "0");
        return parseCaptionComposition(frameDoc, frameWin, content, w, h, dur);
      }).finally(() => {
        activating = false;
      });
    };

    const handleMessage = (e: MessageEvent) => {
      if (!e.source || e.source !== previewIframeRef.current?.contentWindow) return;
      const data = e.data;
      if (data?.source === "hf-preview" && (data?.type === "state" || data?.type === "timeline")) {
        if (!acceptStudioRuntimeMessage(data)) return;
        tryActivateCaptions();
      }
    };

    window.addEventListener("message", handleMessage);
    tryActivateCaptions();

    return () => {
      disposed = true;
      window.removeEventListener("message", handleMessage);
    };
  }, [activeCompPath, projectId, compIdToSrc, captionSync, previewIframeRef, livePreviewIframe]);

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (captionEditMode) {
      setRightCollapsed(!captionHasSelection);
    }
  }, [captionHasSelection, captionEditMode, setRightCollapsed]);
}
