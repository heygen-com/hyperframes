import { useState, useCallback, useRef, type MouseEvent } from "react";
import { useMountEffect } from "./useMountEffect";
import { liveTime, usePlayerStore } from "../player";
import { buildFrameCaptureFilename, buildFrameCaptureUrl } from "../utils/frameCapture";

interface UseFrameCaptureParams {
  projectId: string | null;
  activeCompPath: string | null;
  showToast: (message: string, tone?: "error" | "info") => void;
  waitForPendingDomEditSaves: () => Promise<void>;
}

interface FrameCaptureRequest {
  projectId: string;
  activeCompPath: string | null;
  time: number;
  waitForPendingDomEditSaves: () => Promise<void>;
}

/**
 * Fetch the rendered frame and hand it to the browser as a download. Resolves to
 * the message to show the user, or `undefined` when the capture landed.
 *
 * Module scope, and a returned message instead of a throw, because the React
 * Compiler can lower neither a `throw` inside a `try`/`catch` nor a `finally`,
 * and declines the entire hook when it finds one. The hook is left with the two
 * state writes that bracket the request.
 */
async function downloadCapturedFrame(request: FrameCaptureRequest): Promise<string | undefined> {
  const { projectId, activeCompPath, time, waitForPendingDomEditSaves } = request;
  try {
    await Promise.race([
      waitForPendingDomEditSaves(),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error("Save queue timed out")), 5000),
      ),
    ]);
  } catch (err) {
    return err instanceof Error ? err.message : "Capture failed";
  }
  // The 30s clock starts here, after the save drain, so the two budgets stay
  // separate and the abort can only ever cancel the request itself.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const href = buildFrameCaptureUrl({
      projectId,
      compositionPath: activeCompPath,
      currentTime: time,
    });
    const response = await fetch(href, { cache: "no-store", signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return await captureErrorMessage(response);
    const blobUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = buildFrameCaptureFilename(activeCompPath, time);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    return undefined;
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof DOMException && err.name === "AbortError") {
      return "Capture timed out — the server took too long to respond";
    }
    return err instanceof Error ? err.message : "Capture failed";
  }
}

async function captureErrorMessage(response: Response): Promise<string> {
  try {
    const json = await response.json();
    if (json?.error) return String(json.error);
  } catch {
    /* non-JSON response — use default message */
  }
  return `Capture failed (${response.status})`;
}

export function useFrameCapture({
  projectId,
  activeCompPath,
  showToast,
  waitForPendingDomEditSaves,
}: UseFrameCaptureParams) {
  const [captureFrameTime, setCaptureFrameTime] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const capturingRef = useRef(false);

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
      // A capture can take up to ~35s (save drain + server render) — ignore
      // re-entrant clicks instead of firing parallel captures.
      if (capturingRef.current) return;
      capturingRef.current = true;
      setCapturing(true);
      const time = usePlayerStore.getState().currentTime;
      setCaptureFrameTime(time);
      const failure = await downloadCapturedFrame({
        projectId,
        activeCompPath,
        time,
        waitForPendingDomEditSaves,
      });
      if (failure) showToast(failure, "error");
      capturingRef.current = false;
      setCapturing(false);
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
    capturing,
  };
}
