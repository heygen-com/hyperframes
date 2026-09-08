import { useEffect, useRef } from "react";

/**
 * Run an effect exactly once on mount (and optional cleanup on unmount).
 * This is the ONLY sanctioned way to call useEffect in this codebase.
 *
 * If you need to react to prop/state changes, use one of:
 * - Derived state (compute inline, no hook needed)
 * - Event handlers (onClick, onChange, etc.)
 * - `key` prop to force remount
 * - Data-fetching library (useQuery, useSWR)
 *
 * @see https://react.dev/learn/you-might-not-need-an-effect
 */
export function useMountEffect(effect: () => void | (() => void)) {
  // `useEffect(effect, [])` needed a suppression because `effect` is a new
  // closure every render and the empty list says so. Holding the mount-time
  // closure in a ref makes the list honest without changing which closure runs:
  // `useRef` keeps its initial value, so this is still the first render's
  // `effect`, called once, with its return value used as the unmount cleanup.
  const mountEffect = useRef(effect);
  useEffect(() => mountEffect.current(), []);
}
