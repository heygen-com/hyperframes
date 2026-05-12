import { useState, useCallback, type MouseEvent } from "react";
import { useMountEffect } from "./useMountEffect";
import { liveTime, usePlayerStore } from "../player";
import { buildFrameCaptureFilename, buildFrameCaptureUrl } from "../utils/frameCapture";

interface UseFrameCaptureParams {
  projectId: string | null;
  activeCompPath: string | null;
  showToast: (message: string, tone?: "error" | "info") => void;
  waitForPendingDomEditSaves: () => Promise<void>;
}

export function useFrameCapture({
  projectId,
  activeCompPath,
  showToast,
  waitForPendingDomEditSaves,
}: UseFrameCaptureParams) {
  const [captureFrameTime, setCaptureFrameTime] = useState(0);

  useMountEffect(() => {
    setCaptureFrameTime(usePlayerStore.getState().currentTime);
    return liveTime.subscribe(setCaptureFrameTime);
  });

  const refreshCaptureFrameTime = useCallback(() => {
    setCaptureFrameTime(usePlayerStore.getState().currentTime);
  }, []);

  const handleCaptureFrameClick = useCallback(
    async (event: MouseEvent<HTMLAnchorElement>) => {
      if (!projectId) return;
      event.preventDefault();
      const time = usePlayerStore.getState().currentTime;
      setCaptureFrameTime(time);
      await waitForPendingDomEditSaves();
      const href = buildFrameCaptureUrl({
        projectId,
        compositionPath: activeCompPath,
        currentTime: time,
      });
      const filename = buildFrameCaptureFilename(activeCompPath, time);
      try {
        const response = await fetch(href, { cache: "no-store" });
        if (!response.ok) throw new Error(`Capture failed (${response.status})`);
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Capture failed");
      }
    },
    [activeCompPath, projectId, showToast, waitForPendingDomEditSaves],
  );

  const captureFrameHref = projectId
    ? buildFrameCaptureUrl({
        projectId,
        compositionPath: activeCompPath,
        currentTime: captureFrameTime,
      })
    : "#";
  const captureFrameFilename = buildFrameCaptureFilename(activeCompPath, captureFrameTime);

  return {
    captureFrameHref,
    captureFrameFilename,
    handleCaptureFrameClick,
    refreshCaptureFrameTime,
  };
}
