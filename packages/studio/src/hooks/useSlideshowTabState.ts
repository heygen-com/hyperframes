import { useEffect, useMemo, useState, type MutableRefObject } from "react";
import { SLIDESHOW_ISLAND_TYPE, slideshowIslandRegex } from "@hyperframes/core/slideshow";
import type { SceneInfo } from "../components/panels/SlideshowPanel";
import { previewClipManifest } from "../player/lib/previewChannel";

/**
 * Derives whether the currently-edited composition is a slideshow (carries
 * the slideshow JSON island — the same definitive marker the CLI's `present`
 * command requires; it refuses to run without one) and the live scene list
 * for the Slideshow panel. Extracted from StudioRightPanels to keep that file
 * under the 600-LOC gate.
 */
/** The manifest is frame data: a scene entry must carry a string id and label and finite times. */
function isSceneEntry(value: unknown): value is SceneInfo {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.id === "string" &&
    typeof s.label === "string" &&
    Number.isFinite(s.start) &&
    Number.isFinite(s.duration)
  );
}

export function useSlideshowTabState(params: {
  editingFileContent: string | null | undefined;
  previewIframeRef: MutableRefObject<HTMLIFrameElement | null>;
  refreshKey: number;
  slideshowVisible: boolean;
}): { isSlideshowComposition: boolean; slideshowScenes: SceneInfo[] } {
  const { editingFileContent, previewIframeRef, refreshKey, slideshowVisible } = params;

  // Presence-only (not full manifest validation): a malformed island should
  // still surface the Slideshow tab so the user can see/fix it, rather than
  // making the whole panel disappear. The plain substring check short-circuits
  // the regex scan on every non-slideshow file (the common case) without
  // paying for a full-content RegExp pass.
  const isSlideshowComposition = useMemo(() => {
    if (!editingFileContent || !editingFileContent.includes(SLIDESHOW_ISLAND_TYPE)) return false;
    return slideshowIslandRegex("i").test(editingFileContent);
  }, [editingFileContent]);

  // The scene list from the preview's live clip manifest, read over its editing port.
  const [slideshowScenes, setSlideshowScenes] = useState<SceneInfo[]>([]);
  useEffect(() => {
    const iframe = previewIframeRef.current;
    if (!iframe) return setSlideshowScenes([]);
    let current = true;
    void previewClipManifest(iframe).then((manifest) => {
      if (!current) return;
      const scenes: unknown[] = Array.isArray(manifest?.scenes) ? manifest.scenes : [];
      setSlideshowScenes(
        scenes
          .filter(isSceneEntry)
          .map((s) => ({ id: s.id, label: s.label, start: s.start, duration: s.duration })),
      );
    });
    return () => {
      current = false;
    };
  }, [previewIframeRef, slideshowVisible, refreshKey]);

  return { isSlideshowComposition, slideshowScenes };
}
