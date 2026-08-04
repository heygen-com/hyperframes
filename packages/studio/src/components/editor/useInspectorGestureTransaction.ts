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
  const pendingRef = useRef<{ before: T; latest: T } | null>(null);
  const lastSourceValueRef = useRef(sourceValue);
  if (!Object.is(lastSourceValueRef.current, sourceValue)) {
    lastSourceValueRef.current = sourceValue;
    const matchesOptimisticValue =
      (activeRef.current && Object.is(activeRef.current.latest, sourceValue)) ||
      (pendingRef.current && Object.is(pendingRef.current.latest, sourceValue));
    if (!matchesOptimisticValue) {
      generationRef.current += 1;
      activeRef.current = null;
      pendingRef.current = null;
      sourceRef.current = sourceValue;
    }
  }
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
      pendingRef.current = active;
      try {
        const result = commitRef.current(active.latest);
        void Promise.resolve(result).then(
          () => {
            if (generation === generationRef.current) pendingRef.current = null;
          },
          () => {
            if (generation !== generationRef.current) return;
            pendingRef.current = null;
            sourceRef.current = active.before;
            previewRef.current(active.before);
          },
        );
      } catch {
        if (generation !== generationRef.current) return;
        pendingRef.current = null;
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
