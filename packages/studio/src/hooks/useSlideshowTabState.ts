import { useEffect, useMemo, type MutableRefObject } from "react";
import { SLIDESHOW_ISLAND_TYPE, slideshowIslandRegex } from "@hyperframes/core/slideshow";
import type { SceneInfo } from "../components/panels/SlideshowPanel";
import type { IframeWindow } from "../player/lib/playbackTypes";
import type { RightPanelTab } from "../utils/studioHelpers";

/**
 * Derives whether the currently-edited composition is a slideshow (carries
 * the slideshow JSON island — the same definitive marker the CLI's `present`
 * command requires; it refuses to run without one) and the live scene list
 * for the Slideshow panel, and bounces `rightPanelTab` off "slideshow" the
 * moment it stops applying (e.g. the user switches to a non-slideshow file
 * while that tab was open) so the panel never shows a dangling active tab
 * whose button is no longer even rendered.
 *
 * Extracted from StudioRightPanel to keep that file under the 600-LOC gate.
 */
export function useSlideshowTabState(params: {
  editingFileContent: string | null | undefined;
  previewIframeRef: MutableRefObject<HTMLIFrameElement | null>;
  refreshKey: number;
  rightPanelTab: RightPanelTab;
  setRightPanelTab: (tab: RightPanelTab) => void;
}): { isSlideshowComposition: boolean; slideshowScenes: SceneInfo[] } {
  const { editingFileContent, previewIframeRef, refreshKey, rightPanelTab, setRightPanelTab } =
    params;

  // Presence-only (not full manifest validation): a malformed island should
  // still surface the Slideshow tab so the user can see/fix it, rather than
  // making the whole panel disappear. The plain substring check short-circuits
  // the regex scan on every non-slideshow file (the common case) without
  // paying for a full-content RegExp pass.
  const isSlideshowComposition = useMemo(() => {
    if (!editingFileContent || !editingFileContent.includes(SLIDESHOW_ISLAND_TYPE)) return false;
    return slideshowIslandRegex("i").test(editingFileContent);
  }, [editingFileContent]);

  // Derive scene list from the live clip manifest in the preview iframe.
  const slideshowScenes = useMemo<SceneInfo[]>(() => {
    try {
      const win = previewIframeRef.current?.contentWindow as IframeWindow | null;
      return (win?.__clipManifest?.scenes ?? []).map((s) => ({
        id: s.id,
        label: s.label,
        start: s.start,
        duration: s.duration,
      }));
    } catch {
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewIframeRef, rightPanelTab, refreshKey]);

  useEffect(() => {
    if (rightPanelTab === "slideshow" && !isSlideshowComposition) {
      setRightPanelTab("renders");
    }
  }, [rightPanelTab, isSlideshowComposition, setRightPanelTab]);

  return { isSlideshowComposition, slideshowScenes };
}
