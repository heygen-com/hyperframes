/**
 * Damped harmonic oscillator solver for GSAP CustomEase spring curves.
 *
 * Generates an SVG path data string compatible with `CustomEase.create(id, data)`.
 * The solver supports underdamped (bouncy), critically damped, and overdamped
 * spring configurations. Output is normalized to x ∈ [0,1] with y starting at 0
 * and settling to 1.
 */

export interface SpringPreset {
  name: string;
  label: string;
  mass: number;
  stiffness: number;
  damping: number;
}

export const SPRING_PRESETS: SpringPreset[] = [
  { name: "spring-gentle", label: "Gentle", mass: 1, stiffness: 100, damping: 15 },
  { name: "spring-bouncy", label: "Bouncy", mass: 1, stiffness: 180, damping: 12 },
  { name: "spring-stiff", label: "Stiff", mass: 1, stiffness: 300, damping: 20 },
  { name: "spring-wobbly", label: "Wobbly", mass: 1, stiffness: 120, damping: 8 },
  { name: "spring-heavy", label: "Heavy", mass: 3, stiffness: 200, damping: 20 },
];

/**
 * Solve a damped harmonic oscillator and return a GSAP CustomEase data string.
 *
 * The output is an SVG path (`M0,0 L... L...`) that CustomEase.create() accepts.
 * The curve is normalized so x spans [0,1] and the spring settles at y = 1.
 *
 * @param mass - Spring mass (> 0)
 * @param stiffness - Spring stiffness constant (> 0)
 * @param damping - Damping coefficient (> 0)
 * @param steps - Number of sample points (default 120)
 */
export function generateSpringEaseData(
  mass: number,
  stiffness: number,
  damping: number,
  steps = 120,
): string {
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));

  // Determine simulation duration: time until oscillation settles within threshold of 1.0.
  // Underdamped: ~5 time constants. Critically/overdamped: characteristic decay time.
  let settleDuration: number;
  if (zeta < 1) {
    settleDuration = Math.min(5 / (zeta * w0), 10);
  } else {
    const decayRate = zeta * w0 - w0 * Math.sqrt(zeta * zeta - 1);
    settleDuration = Math.min(4 / Math.max(decayRate, 0.01), 10);
  }
  const simDuration = Math.max(settleDuration, 1);

  const segments: string[] = ["M0,0"];

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const simT = t * simDuration;
    let value: number;

    if (zeta < 1) {
      // Underdamped — oscillates before settling
      const wd = w0 * Math.sqrt(1 - zeta * zeta);
      value =
        1 -
        Math.exp(-zeta * w0 * simT) *
          (Math.cos(wd * simT) + ((zeta * w0) / wd) * Math.sin(wd * simT));
    } else if (zeta === 1) {
      // Critically damped — fastest approach without oscillation
      value = 1 - (1 + w0 * simT) * Math.exp(-w0 * simT);
    } else {
      // Overdamped — slow exponential approach
      const s1 = -w0 * (zeta - Math.sqrt(zeta * zeta - 1));
      const s2 = -w0 * (zeta + Math.sqrt(zeta * zeta - 1));
      value = 1 + (s1 * Math.exp(s2 * simT) - s2 * Math.exp(s1 * simT)) / (s2 - s1);
    }

    segments.push(`${t.toFixed(4)},${value.toFixed(4)}`);
  }

  // Force exact endpoint
  segments[segments.length - 1] = "1,1";

  return `${segments[0]} L${segments.slice(1).join(" ")}`;
}
