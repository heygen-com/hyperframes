import { useCallback, useEffect, useRef, useState } from "react";
import { hasFiredSessionStart, markSessionStartFired } from "../telemetry/config";
import { trackStudioSessionStart } from "../telemetry/events";
import { readStudioUiPreferences, writeStudioUiPreferences } from "../utils/studioUiPreferences";

export function useStudioSessionStartTelemetry(
  projectId: string | null,
  resolving: boolean,
  waitingForServer: boolean,
): void {
  useEffect(() => {
    if (resolving || waitingForServer) return;
    if (hasFiredSessionStart()) return;
    markSessionStartFired();
    trackStudioSessionStart({ has_project: projectId != null });
  }, [projectId, resolving, waitingForServer]);
}

export function usePreviewDocumentVersionRefresh(): {
  previewDocumentVersion: number;
  refreshPreviewDocumentVersion: () => void;
} {
  const [previewDocumentVersion, setPreviewDocumentVersion] = useState(0);
  const refreshTimersRef = useRef<number[]>([]);
  const refreshPreviewDocumentVersion = useCallback(() => {
    for (const id of refreshTimersRef.current) clearTimeout(id);
    refreshTimersRef.current = [];
    setPreviewDocumentVersion((v) => v + 1);
    refreshTimersRef.current.push(
      window.setTimeout(() => setPreviewDocumentVersion((v) => v + 1), 80),
      window.setTimeout(() => setPreviewDocumentVersion((v) => v + 1), 300),
    );
  }, []);
  useEffect(
    () => () => {
      for (const id of refreshTimersRef.current) clearTimeout(id);
    },
    [],
  );
  return { previewDocumentVersion, refreshPreviewDocumentVersion };
}

export function useTimelineVisibilityPreference(initialTimelineVisible?: boolean): {
  timelineVisible: boolean;
  toggleTimelineVisibility: () => void;
} {
  const [timelineVisible, setTimelineVisible] = useState(
    () => initialTimelineVisible ?? readStudioUiPreferences().timelineVisible ?? true,
  );
  const toggleTimelineVisibility = useCallback(() => {
    setTimelineVisible((v) => {
      writeStudioUiPreferences({ timelineVisible: !v });
      return !v;
    });
  }, []);
  return { timelineVisible, toggleTimelineVisibility };
}
