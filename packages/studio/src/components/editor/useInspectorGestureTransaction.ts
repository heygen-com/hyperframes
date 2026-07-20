import { useCallback, useEffect, useRef } from "react";

/** One owner for continuous inspector edits: preview freely, persist once. */
export function useInspectorGestureTransaction<T>({
  sourceValue,
  onPreview,
  onCommit,
}: {
  sourceValue: T;
  onPreview: (value: T) => void;
  onCommit: (value: T) => void;
}) {
  const sourceRef = useRef(sourceValue);
  const activeRef = useRef<{ before: T; latest: T } | null>(null);
  const previewRef = useRef(onPreview);
  const commitRef = useRef(onCommit);
  if (!activeRef.current) sourceRef.current = sourceValue;
  previewRef.current = onPreview;
  commitRef.current = onCommit;

  const begin = useCallback(() => {
    if (!activeRef.current) {
      activeRef.current = { before: sourceRef.current, latest: sourceRef.current };
    }
  }, []);

  const preview = useCallback((value: T) => {
    if (!activeRef.current) {
      activeRef.current = { before: sourceRef.current, latest: sourceRef.current };
    }
    activeRef.current.latest = value;
    previewRef.current(value);
  }, []);

  const settle = useCallback(() => {
    const active = activeRef.current;
    activeRef.current = null;
    if (active && !Object.is(active.before, active.latest)) {
      sourceRef.current = active.latest;
      // Restore the captured baseline before the persistent commit captures
      // rollback state. The commit reapplies `latest` synchronously, so this
      // is not visible but a failed save can now correctly restore `before`.
      previewRef.current(active.before);
      commitRef.current(active.latest);
    }
  }, []);

  const cancel = useCallback(() => {
    const active = activeRef.current;
    activeRef.current = null;
    if (active && !Object.is(active.before, active.latest)) {
      sourceRef.current = active.before;
      previewRef.current(active.before);
    }
  }, []);

  useEffect(() => cancel, [cancel]);

  return { begin, preview, settle, cancel, activeRef };
}
