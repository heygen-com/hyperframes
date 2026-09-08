import { useEffect, useMemo, useState, type MutableRefObject } from "react";
import { SLIDESHOW_ISLAND_TYPE, slideshowIslandRegex } from "@hyperframes/core/slideshow";
import type { SceneInfo } from "../components/panels/SlideshowPanel";
import type { IframeWindow } from "../player/lib/playbackTypes";
import type { RightPanelTab } from "../utils/studioHelpers";

/** The live scene list the preview is currently playing, or none. */
function readSlideshowScenes(iframe: HTMLIFrameElement | null): SceneInfo[] {
  try {
    const win = iframe?.contentWindow as IframeWindow | null;
    return (win?.__clipManifest?.scenes ?? []).map((s) => ({
      id: s.id,
      label: s.label,
      start: s.start,
      duration: s.duration,
    }));
  } catch {
    return [];
  }
}

/** Scene lists are short and flat, so equality is a field-by-field walk. */
function sameScenes(a: SceneInfo[], b: SceneInfo[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((scene, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      scene.id === other.id &&
      scene.label === other.label &&
      scene.start === other.start &&
      scene.duration === other.duration
    );
  });
}

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

  // The scene list comes from the preview iframe, which is live mutable state
  // rather than a render input: read on commit, not during render. `rightPanelTab`
  // and `refreshKey` are re-read triggers (opening the tab, and a preview reload),
  // which is why the memo this replaces needed a suppression to keep them.
  const [slideshowScenes, setSlideshowScenes] = useState<SceneInfo[]>([]);
  useEffect(() => {
    const next = readSlideshowScenes(previewIframeRef.current);
    // Keeping the previous array when nothing moved is what stops this read
    // costing a second commit on every tab switch, which the memo it replaces
    // never did.
    setSlideshowScenes((prev) => (sameScenes(prev, next) ? prev : next));
  }, [previewIframeRef, rightPanelTab, refreshKey]);

  useEffect(() => {
    if (rightPanelTab === "slideshow" && !isSlideshowComposition) {
      setRightPanelTab("renders");
    }
  }, [rightPanelTab, isSlideshowComposition, setRightPanelTab]);

  return { isSlideshowComposition, slideshowScenes };
}
