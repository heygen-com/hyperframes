// Gated strategic logging for the GSAP keyframe / manual-drag / gesture / razor
// edit flows. Silent in production; on in dev builds, or anywhere once you set
// `window.__hfDebug = true` in the console. Single `[hf-edit:<scope>]` prefix so
// the whole edit pipeline is greppable. Fires only at commit boundaries (user
// actions), never in render/raf loops, so it doesn't spam.
export function editLog(_scope: string, ..._args: unknown[]): void {
  // ponytail: body removed — all console.* stripped from studio.
  // Restore with: console.log(`[hf-edit:${_scope}]`, ..._args);
}
