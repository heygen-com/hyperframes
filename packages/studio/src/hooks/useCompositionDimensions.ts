import { useState } from "react";
import { useMountEffect } from "./useMountEffect";
import type { CompositionDimensions } from "../components/renders/RenderQueue";

export function useCompositionDimensions() {
  const [compositionDimensions, setCompositionDimensions] = useState<CompositionDimensions | null>(
    null,
  );

  useMountEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      const data = e.data;
      if (data?.source !== "hf-preview" || data?.type !== "stage-size") return;
      const { width, height } = data as { width: number; height: number };
      if (!(width > 0) || !(height > 0)) return;
      setCompositionDimensions((prev) =>
        prev && prev.width === width && prev.height === height ? prev : { width, height },
      );
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  });

  return compositionDimensions;
}
