import { useState, useCallback, useRef, useEffect } from "react";
import {
  startRender,
  subscribeProgress,
  getDownloadUrl,
  type RenderProgress,
} from "../api/render";

type RenderState = "idle" | "rendering" | "complete" | "error";

interface RenderOptions {
  debug?: boolean;
  sequential?: boolean;
}

interface UseRenderReturn {
  state: RenderState;
  progress: number;
  stage: string;
  error: string | null;
  start: (options?: RenderOptions) => void;
}

export function useRender(projectId: string): UseRenderReturn {
  const [state, setState] = useState<RenderState>("idle");
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) unsubscribeRef.current();
    };
  }, []);

  const start = useCallback(async (options?: RenderOptions) => {
    if (state === "rendering") return;

    setState("rendering");
    setProgress(0);
    setStage("Starting...");
    setError(null);

    try {
      const jobId = await startRender(projectId, { debug: options?.debug, sequential: options?.sequential });

      unsubscribeRef.current = subscribeProgress(
        jobId,
        (data: RenderProgress) => {
          setProgress(data.progress);
          setStage(data.stage);

          if (data.status === "complete") {
            setState("complete");
            if (unsubscribeRef.current) {
              unsubscribeRef.current();
              unsubscribeRef.current = null;
            }

            // Trigger download
            const url = getDownloadUrl(jobId);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${projectId}.mp4`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            // Reset to idle after a brief display
            setTimeout(() => setState("idle"), 3000);
          } else if (data.status === "failed") {
            setState("error");
            setError(data.error || "Render failed");
            if (unsubscribeRef.current) {
              unsubscribeRef.current();
              unsubscribeRef.current = null;
            }
          }
        },
        () => {
          setState("error");
          setError("Connection lost");
        }
      );
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Failed to start render");
    }
  }, [projectId, state]);

  return { state, progress, stage, error, start };
}
