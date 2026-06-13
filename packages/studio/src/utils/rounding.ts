/** Round to 3 decimal places (millisecond precision for GSAP values). */
export function roundTo3(val: number): number {
  return Math.round(val * 1000) / 1000;
}

/** Round to 2 decimal places (centisecond precision for timeline values). */
export function roundToCenti(val: number): number {
  return Math.round(val * 100) / 100;
}
