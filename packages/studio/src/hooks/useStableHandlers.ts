import { useRef } from "react";

type Handler = (...args: never[]) => unknown;

// The same object while its non-function fields are unchanged; each function field keeps one identity that calls
// the latest one, so a hook result rebuilt every render re-renders its consumers only when its data changes.
export function useStableHandlers<T extends object>(value: T): T {
  const latest = useRef(value);
  latest.current = value;
  const wrappers = useRef(new Map<string, Handler>());
  const previous = useRef<T | null>(null);

  const next: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    if (typeof field !== "function") {
      next[key] = field;
      continue;
    }
    let wrapper = wrappers.current.get(key);
    if (!wrapper) {
      wrapper = (...args: never[]) =>
        (latest.current as Record<string, (...a: never[]) => unknown>)[key]!(...args);
      wrappers.current.set(key, wrapper);
    }
    next[key] = wrapper;
  }
  const prev = previous.current as Record<string, unknown> | null;
  const keys = Object.keys(next);
  if (prev && keys.length === Object.keys(prev).length && keys.every((k) => prev[k] === next[k]))
    return previous.current!;
  previous.current = next as T;
  return previous.current;
}
