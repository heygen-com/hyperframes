import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import type { LintFinding } from "../components/LintModal";

interface RawFinding {
  severity?: string;
  message?: string;
  file?: string;
  fixHint?: string;
  elementId?: string;
  selector?: string;
  code?: string;
}

function parseFinding(f: RawFinding): LintFinding & { elementId?: string; file?: string } {
  return {
    severity: f.severity === "error" ? ("error" as const) : ("warning" as const),
    message: f.message ?? "",
    file: f.file,
    fixHint: f.fixHint,
    elementId: f.elementId,
  };
}

export function useLintModal(projectId: string | null, refreshKey?: number) {
  const [lintModal, setLintModal] = useState<LintFinding[] | null>(null);
  const [linting, setLinting] = useState(false);
  const [backgroundFindings, setBackgroundFindings] = useState<
    Array<LintFinding & { elementId?: string; file?: string }>
  >([]);
  const autoLintRanRef = useRef(false);

  const runLint = useCallback(
    async (opts?: { background?: boolean }) => {
      if (!projectId) return;
      if (!opts?.background) setLinting(true);
      try {
        const res = await fetch(`/api/projects/${projectId}/lint`);
        const data = await res.json();
        const parsed = ((data.findings ?? []) as RawFinding[]).map(parseFinding);
        if (opts?.background) {
          setBackgroundFindings(parsed);
        } else {
          setLintModal(parsed);
          setBackgroundFindings(parsed);
        }
      } catch (err) {
        if (!opts?.background) {
          const msg = err instanceof Error ? err.message : String(err);
          setLintModal([{ severity: "error", message: `Failed to run lint: ${msg}` }]);
        }
      } finally {
        if (!opts?.background) setLinting(false);
      }
    },
    [projectId],
  );

  const handleLint = useCallback(() => runLint(), [runLint]);

  const prevProjectIdRef = useRef(projectId);
  useEffect(() => {
    if (projectId !== prevProjectIdRef.current) {
      autoLintRanRef.current = false;
      prevProjectIdRef.current = projectId;
    }
    if (!projectId || autoLintRanRef.current) return;
    autoLintRanRef.current = true;
    void runLint({ background: true });
  }, [projectId, runLint]);

  useEffect(() => {
    if (!projectId || !refreshKey) return;
    const timer = setTimeout(() => void runLint({ background: true }), 1000);
    return () => clearTimeout(timer);
  }, [projectId, refreshKey, runLint]);

  const closeLintModal = useCallback(() => setLintModal(null), []);

  const groupFindings = useCallback(
    (keyFn: (f: (typeof backgroundFindings)[0]) => string | undefined) => {
      const map = new Map<string, { count: number; messages: string[] }>();
      for (const f of backgroundFindings) {
        const key = keyFn(f);
        if (!key) continue;
        const prev = map.get(key) ?? { count: 0, messages: [] };
        prev.count += 1;
        prev.messages.push(f.message);
        map.set(key, prev);
      }
      return map;
    },
    [backgroundFindings],
  );

  const findingsByElement = useMemo(() => groupFindings((f) => f.elementId), [groupFindings]);
  const findingsByFile = useMemo(() => groupFindings((f) => f.file), [groupFindings]);

  return {
    lintModal,
    linting,
    handleLint,
    closeLintModal,
    backgroundFindings,
    findingsByElement,
    findingsByFile,
  };
}
