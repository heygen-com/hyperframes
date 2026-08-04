import { useCallback, useEffect, useRef, useState } from "react";

/** One owner for continuous inspector edits: preview freely, persist once. */
export function useInspectorGestureTransaction<T>({
  sourceValue,
  onPreview,
  onCommit,
}: {
  sourceValue: T;
  onPreview: (value: T) => void;
  onCommit: (value: T) => void | Promise<void>;
}) {
  const sourceRef = useRef(sourceValue);
  const activeRef = useRef<{ before: T; latest: T } | null>(null);
  const previewRef = useRef(onPreview);
  const commitRef = useRef(onCommit);
  const generationRef = useRef(0);
  if (!activeRef.current) sourceRef.current = sourceValue;
  previewRef.current = onPreview;
  commitRef.current = onCommit;

  const begin = useCallback(() => {
    if (!activeRef.current) {
      generationRef.current += 1;
      activeRef.current = { before: sourceRef.current, latest: sourceRef.current };
    }
  }, []);

  const preview = useCallback((value: T) => {
    if (!activeRef.current) {
      generationRef.current += 1;
      activeRef.current = { before: sourceRef.current, latest: sourceRef.current };
    }
    activeRef.current.latest = value;
    previewRef.current(value);
  }, []);

  const settle = useCallback(() => {
    const active = activeRef.current;
    activeRef.current = null;
    if (active && !Object.is(active.before, active.latest)) {
      const generation = ++generationRef.current;
      sourceRef.current = active.latest;
      // Restore the captured baseline before the persistent commit captures
      // rollback state. The commit owner remains responsible for applying its
      // durable/optimistic value; some controls intentionally leave the
      // baseline preview in place until their source value advances.
      previewRef.current(active.before);
      try {
        const result = commitRef.current(active.latest);
        void Promise.resolve(result).catch(() => {
          if (generation !== generationRef.current) return;
          sourceRef.current = active.before;
          previewRef.current(active.before);
        });
      } catch {
        if (generation !== generationRef.current) return;
        sourceRef.current = active.before;
        previewRef.current(active.before);
      }
    }
  }, []);

  const cancel = useCallback(() => {
    generationRef.current += 1;
    const active = activeRef.current;
    activeRef.current = null;
    if (active && !Object.is(active.before, active.latest)) {
      sourceRef.current = active.before;
      previewRef.current(active.before);
    }
  }, []);

  useEffect(() => {
    generationRef.current += 1;
  }, [sourceValue]);

  useEffect(() => cancel, [cancel]);

  return { begin, preview, settle, cancel, activeRef };
}

export function useInspectorGestureDraft<T>({
  sourceValue,
  onPreview,
  onCommit,
}: {
  sourceValue: T;
  onPreview: (value: T) => void;
  onCommit: (value: T) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(sourceValue);
  const transaction = useInspectorGestureTransaction({
    sourceValue,
    onPreview: (next) => {
      setDraft(next);
      onPreview(next);
    },
    onCommit: (next) => {
      setDraft(next);
      return onCommit(next);
    },
  });

  useEffect(() => {
    if (!transaction.activeRef.current) setDraft(sourceValue);
  }, [sourceValue, transaction.activeRef]);

  return { draft, setDraft, transaction };
}
