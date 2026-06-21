// Gated strategic logging for the GSAP keyframe / manual-drag / gesture / razor
// edit flows. Silent in production; on in dev builds, or anywhere once you set
// `window.__hfDebug = true` in the console. Single `[hf-edit:<scope>]` prefix so
// the whole edit pipeline is greppable. Fires only at commit boundaries (user
// actions), never in render/raf loops, so it doesn't spam.
export function editLog(scope: string, ...args: unknown[]): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __hfDebug?: boolean };
  if (!import.meta.env.DEV && !w.__hfDebug) return;
  // Stringify object args so the console prints their contents inline (`{x:1}`)
  // instead of a collapsed `Object` — keeps the edit trail greppable/copyable.
  const parts = args.map((a) =>
    typeof a === "object" && a !== null ? JSON.stringify(a) : String(a),
  );
  console.debug(`[hf-edit:${scope}]`, ...parts);
}
