import { useCallback, useRef, useState } from "react";
import { buildProjectApiPath } from "../../utils/projectRouting";
import type { PreviewCompositionSize } from "../../utils/previewCompositionSize";

/** Frame 0 as the thumbnail route last rendered it; `cachedOnly` never starts a render. */
function previewPosterUrl(projectId: string, cachedOnly: boolean): string {
  const query = `t=0&output=source${cachedOnly ? "&cached=1" : ""}`;
  return buildProjectApiPath(projectId, `/thumbnail/index.html?${query}`);
}

const PREVIEW_POSTER_STYLE: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  objectFit: "contain",
  zIndex: 2,
  pointerEvents: "none",
};

/** Covers the live preview with the cached frame 0; reports its size so the stage fits it. */
export function PreviewPoster({
  projectId,
  hidden,
  onSize,
  onLoaded,
  onMissing,
}: {
  projectId: string;
  hidden: boolean;
  onSize: (size: PreviewCompositionSize) => void;
  onLoaded: () => void;
  onMissing: () => void;
}) {
  return (
    <img
      src={previewPosterUrl(projectId, true)}
      alt=""
      aria-hidden
      data-testid="preview-poster"
      hidden={hidden}
      style={PREVIEW_POSTER_STYLE}
      onLoad={(event) => {
        const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
        if (!hidden && width > 0 && height > 0) onSize({ width, height });
        onLoaded();
      }}
      onError={onMissing}
    />
  );
}

/** The poster covers the live slot until its first frame is ready; a missing poster is rendered
 * after both are known, in either order, off the open path, for the next open. */
export function usePreviewPoster(
  projectId: string,
  activeKey: string,
  directUrl: string | undefined,
) {
  const visit = useVisitNumber(activeKey);
  const [coverDoneFor, setCoverDoneFor] = useState<number | null>(null);
  const [posterSettledFor, setPosterSettledFor] = useState<number | null>(null);
  const missingForRef = useRef<number | null>(null);
  const liveReadyForRef = useRef<number | null>(null);
  const renderMissingPoster = useCallback(() => {
    if (missingForRef.current !== visit || liveReadyForRef.current !== visit) return;
    missingForRef.current = null;
    void fetch(previewPosterUrl(projectId, false)).catch(() => {});
  }, [visit, projectId]);
  const onLiveReadyToShowChange = useCallback(
    (ready: boolean) => {
      if (!ready) return;
      setCoverDoneFor(visit);
      liveReadyForRef.current = visit;
      renderMissingPoster();
    },
    [visit, renderMissingPoster],
  );
  return {
    mountPoster: !directUrl && (coverDoneFor !== visit || posterSettledFor !== visit),
    hidePoster: coverDoneFor === visit,
    onLiveReadyToShowChange,
    onPreviewError: () => setCoverDoneFor(visit),
    onPosterLoaded: () => setPosterSettledFor(visit),
    onPosterMissing: () => {
      setCoverDoneFor(visit);
      setPosterSettledFor(visit);
      missingForRef.current = visit;
      renderMissingPoster();
    },
  };
}

function useVisitNumber(key: string): number {
  const [seen, setSeen] = useState({ key, visit: 0 });
  if (seen.key === key) return seen.visit;
  setSeen({ key, visit: seen.visit + 1 });
  return seen.visit + 1;
}
