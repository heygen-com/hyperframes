/**
 * Relative-epsilon numeric equality shared by the shadow diffs (timing parity +
 * GSAP value fidelity). Both writers round-trip durations/positions through JS
 * number formatting, so a value like 3.1 can read back as 3.0999999999999996.
 * Treat values within 1e-6 * max(1, |a|, |b|) as equal — tight enough that a
 * real 2 vs 1 (or 0.5 vs 0.49) still flags, loose enough to absorb float noise.
 */
export function relEqual(a: number, b: number): boolean {
  if (a === b) return true;
  return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
}
