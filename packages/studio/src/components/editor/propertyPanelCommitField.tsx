import { useEffect, useRef, useState } from "react";
import { adjustNumericToken, parseNumericToken } from "./propertyPanelHelpers";
import { useInspectorGestureTransaction } from "./useInspectorGestureTransaction";

function arrowDirection(key: string): 1 | -1 | null {
  if (key === "ArrowUp") return 1;
  if (key === "ArrowDown") return -1;
  return null;
}

export function CommitField({
  value,
  disabled,
  liveCommit,
  onPreview,
  onCommit,
}: {
  value: string;
  disabled?: boolean;
  liveCommit?: boolean;
  onPreview?: (nextValue: string) => void;
  onCommit: (nextValue: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const valueRef = useRef(value);
  const draftRef = useRef(draft);
  const inputRef = useRef<HTMLInputElement>(null);
  const focusedRef = useRef(false);
  const dirtyRef = useRef(false);
  valueRef.current = value;
  draftRef.current = draft;

  const wheelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelActiveRef = useRef(false);
  const wheelTransaction = useInspectorGestureTransaction({
    sourceValue: value,
    onPreview: (nextValue) => {
      setDraft(nextValue);
      onPreview?.(nextValue);
    },
    onCommit,
  });
  const wheelTransactionRef = useRef(wheelTransaction);
  wheelTransactionRef.current = wheelTransaction;

  const settleWheel = () => {
    if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
    wheelTimerRef.current = null;
    if (!wheelActiveRef.current) return false;
    wheelActiveRef.current = false;
    wheelTransaction.settle();
    return true;
  };
  const commitDraft = (nextValue: string) => {
    setDraft(nextValue);
    onPreview?.(nextValue);
    if (nextValue !== valueRef.current) onCommit(nextValue);
  };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      if (!wheelActiveRef.current) return;
      event.preventDefault();
      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
      wheelTimerRef.current = null;
      wheelActiveRef.current = false;
      wheelTransaction.cancel();
      return;
    }
    if (event.key === "Enter") {
      event.currentTarget.blur();
      return;
    }
    const direction = arrowDirection(event.key);
    if (direction === null) return;
    settleWheel();
    const nextDraft = adjustNumericToken(draft, direction, event);
    if (!nextDraft) return;
    event.preventDefault();
    dirtyRef.current = true;
    setDraft(nextDraft);
    if (liveCommit) onPreview?.(nextDraft);
    commitDraft(nextDraft);
  };

  useEffect(() => {
    if (focusedRef.current && dirtyRef.current) return;
    setDraft(value);
  }, [value]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const handler = (event: WheelEvent) => {
      if (disabled || document.activeElement !== el) return;
      const delta = event.deltaY === 0 ? event.deltaX : event.deltaY;
      if (delta === 0) return;
      const nextDraft = adjustNumericToken(draftRef.current, delta < 0 ? 1 : -1, event);
      if (!nextDraft) return;
      event.preventDefault();
      event.stopPropagation();
      dirtyRef.current = false;
      wheelActiveRef.current = true;
      wheelTransactionRef.current.preview(nextDraft);
      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
      wheelTimerRef.current = setTimeout(() => {
        wheelTimerRef.current = null;
        wheelActiveRef.current = false;
        wheelTransactionRef.current.settle();
      }, 180);
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => {
      el.removeEventListener("wheel", handler);
      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
    };
  }, [disabled]);

  return (
    <input
      ref={inputRef}
      type="text"
      value={draft}
      disabled={disabled}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onChange={(event) => {
        settleWheel();
        dirtyRef.current = true;
        setDraft(event.target.value);
        if (liveCommit) onPreview?.(event.target.value);
      }}
      onBlur={() => {
        if (settleWheel()) {
          focusedRef.current = false;
          return;
        }
        const wasDirty = dirtyRef.current;
        focusedRef.current = false;
        dirtyRef.current = false;
        if (wasDirty && (!liveCommit || parseNumericToken(draft))) {
          commitDraft(draft);
        } else {
          setDraft(valueRef.current);
          if (wasDirty && liveCommit) onPreview?.(valueRef.current);
        }
      }}
      onKeyDown={handleKeyDown}
      title={parseNumericToken(value) ? "Scroll or use Arrow keys to adjust" : undefined}
      className="min-w-0 w-full bg-transparent text-[11px] font-medium text-neutral-100 outline-none disabled:cursor-not-allowed disabled:text-neutral-600"
    />
  );
}
