import { useRef, useCallback } from "react";
import { useCaptionStore } from "../store";
import { generateCaptionHtml } from "../generator";
import { useMountEffect } from "../../hooks/useMountEffect";

export function useCaptionSync(projectId: string | null) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const writeToSource = useCallback(
    (filePath: string, html: string) => {
      if (!projectId || !filePath) return;
      fetch(`/api/projects/${projectId}/files/${encodeURIComponent(filePath)}`, {
        method: "PUT",
        headers: { "Content-Type": "text/plain" },
        body: html,
      }).catch(() => {});
    },
    [projectId],
  );

  useMountEffect(() => {
    let prevModel = useCaptionStore.getState().model;

    const unsubscribe = useCaptionStore.subscribe((state) => {
      if (!state.isEditMode) return;
      if (state.model === prevModel) return;

      prevModel = state.model;

      if (!state.model) return;

      const model = state.model;
      const filePath = state.sourceFilePath;

      if (!filePath) return;

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const html = generateCaptionHtml(model);
        writeToSource(filePath, html);
      }, 400);
    });

    return () => {
      unsubscribe();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  });
}
