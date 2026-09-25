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
  onSize,
  onMissing,
}: {
  projectId: string;
  onSize: (size: PreviewCompositionSize) => void;
  onMissing: () => void;
}) {
  return (
    <img
      src={previewPosterUrl(projectId, true)}
      alt=""
      aria-hidden
      data-testid="preview-poster"
      style={PREVIEW_POSTER_STYLE}
      onLoad={(event) => {
        const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
        if (width > 0 && height > 0) onSize({ width, height });
      }}
      onError={onMissing}
    />
  );
}

/** The poster covers the live slot until its first frame is ready to show; a missing poster is
 * rendered after that, off the open path, for the next open. */
export function usePreviewPoster(
  projectId: string,
  activeKey: string,
  directUrl: string | undefined,
) {
  const [posterDoneFor, setPosterDoneFor] = useState<string | null>(null);
  const posterMissingRef = useRef(false);
  const onLiveReadyToShowChange = useCallback(
    (ready: boolean) => {
      if (!ready) return;
      setPosterDoneFor(activeKey);
      if (!posterMissingRef.current || directUrl) return;
      posterMissingRef.current = false;
      void fetch(previewPosterUrl(projectId, false)).catch(() => {});
    },
    [activeKey, directUrl, projectId],
  );
  return {
    showPoster: !directUrl && posterDoneFor !== activeKey,
    onLiveReadyToShowChange,
    onPreviewError: () => setPosterDoneFor(activeKey),
    onPosterMissing: () => {
      posterMissingRef.current = true;
      setPosterDoneFor(activeKey);
    },
  };
}
