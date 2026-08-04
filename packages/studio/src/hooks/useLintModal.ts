import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import type { LintFinding } from "../components/LintModal";
import { usePlayerStore } from "../player";

interface RawFinding {
  severity?: string;
  message?: string;
  file?: string;
  fixHint?: string;
  elementId?: string;
  selector?: string;
  code?: string;
}

type ParsedFinding = LintFinding & { elementId?: string; file?: string };

function parseFinding(f: RawFinding): ParsedFinding {
  return {
    severity: f.severity === "error" ? ("error" as const) : ("warning" as const),
    message: f.message ?? "",
    file: f.file,
    fixHint: f.fixHint,
    elementId: f.elementId,
  };
}

/**
 * Module scope, not a `useCallback` capturing `backgroundFindings`.
 *
 * A memoized callback that closes over render-scoped state is stored into the
 * NEXT render's scope whenever its deps are unchanged, which chains every
 * render scope to the previous one. Each link pins that render's findings
 * array, so one project switch leaked a full lint result (~240 findings)
 * forever. Taking the findings as an argument keeps them out of any closure.
 */
export function groupFindings(
  findings: readonly ParsedFinding[],
  keyFn: (f: ParsedFinding) => string | undefined,
): Map<string, { count: number; messages: string[] }> {
  const map = new Map<string, { count: number; messages: string[] }>();
  for (const f of findings) {
    const key = keyFn(f);
    if (!key) continue;
    const prev = map.get(key) ?? { count: 0, messages: [] };
    prev.count += 1;
    prev.messages.push(f.message);
    map.set(key, prev);
  }
  return map;
}

export function useLintModal(projectId: string | null, refreshKey?: number) {
  const [lintModal, setLintModal] = useState<LintFinding[] | null>(null);
  const [linting, setLinting] = useState(false);
  const [backgroundFindings, setBackgroundFindings] = useState<ParsedFinding[]>([]);
  const autoLintRanRef = useRef(false);
  // `runLint` reads the project through a ref so it can be created once. A
  // `[projectId]`-keyed callback is recreated on every switch and the stale one
  // lands in the new render's scope, chaining scopes (and their findings).
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  const runLint = useCallback(async (opts?: { background?: boolean }) => {
    const projectId = projectIdRef.current;
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
  }, []);

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

  const findingsByElement = useMemo(
    () => groupFindings(backgroundFindings, (f) => f.elementId),
    [backgroundFindings],
  );
  const findingsByFile = useMemo(
    () => groupFindings(backgroundFindings, (f) => f.file),
    [backgroundFindings],
  );

  // Sync lint findings directly to the player store — eliminates the
  // mirroring useEffect that was previously in App.tsx.
  useEffect(() => {
    usePlayerStore.getState().setLintFindingsByElement(findingsByElement);
  }, [findingsByElement]);

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
