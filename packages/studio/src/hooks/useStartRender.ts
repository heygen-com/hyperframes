import { useCallback, useRef } from "react";
import type {
  EnqueueRenderOptions,
  StartRenderOptions,
} from "../components/renders/useRenderQueue";
import { trackStudioRenderStart } from "../telemetry/events";

export type RenderStartOptions = Omit<StartRenderOptions, "composition">;

export type StartRenderAction = (
  composition: string | undefined,
  options?: RenderStartOptions,
) => Promise<void>;

interface UseStartRenderOptions {
  enqueueRender: (options: EnqueueRenderOptions) => Promise<void>;
  isRendering: boolean;
  waitForPendingDomEditSaves: () => Promise<void>;
  showToast: (message: string, tone?: "error" | "info") => void;
}

export function useStartRender({
  enqueueRender,
  isRendering,
  waitForPendingDomEditSaves,
  showToast,
}: UseStartRenderOptions): StartRenderAction {
  const startingRef = useRef(false);

  return useCallback(
    async (composition, options = {}) => {
      if (startingRef.current || isRendering) return;
      startingRef.current = true;
      try {
        await waitForPendingDomEditSaves();
        const fps = options.fps ?? 30;
        const quality = options.quality ?? "standard";
        const format = options.format ?? "mp4";
        trackStudioRenderStart({
          fps,
          quality,
          format,
          resolution: options.resolution,
          composition,
        });
        await enqueueRender({ ...options, fps, quality, format, composition });
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Could not start render.", "error");
      } finally {
        startingRef.current = false;
      }
    },
    [enqueueRender, isRendering, showToast, waitForPendingDomEditSaves],
  );
}
