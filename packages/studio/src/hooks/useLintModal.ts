import { useState, useCallback } from "react";
import type { LintFinding } from "../components/LintModal";

export function useLintModal(projectId: string | null) {
  const [lintModal, setLintModal] = useState<LintFinding[] | null>(null);
  const [linting, setLinting] = useState(false);

  const handleLint = useCallback(async () => {
    if (!projectId) return;
    setLinting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/lint`);
      const data = await res.json();
      setLintModal(
        (data.findings ?? []).map(
          (f: { severity?: string; message?: string; file?: string; fixHint?: string }) => ({
            severity: f.severity === "error" ? ("error" as const) : ("warning" as const),
            message: f.message ?? "",
            file: f.file,
            fixHint: f.fixHint,
          }),
        ),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLintModal([{ severity: "error", message: `Failed to run lint: ${msg}` }]);
    } finally {
      setLinting(false);
    }
  }, [projectId]);

  const closeLintModal = useCallback(() => setLintModal(null), []);

  return { lintModal, linting, handleLint, closeLintModal };
}
