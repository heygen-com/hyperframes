const SPRING_TOKEN = /^\s*spring\(\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*\)\s*$/;

function clampBounce(bounce: number): number {
  return Math.max(0, Math.min(1, bounce));
}

/** Parse Studio's single-parameter spring token into a normalized bounce value. */
export function parseSpringBounce(ease: string): number | null {
  const match = SPRING_TOKEN.exec(ease);
  if (!match) return null;
  const bounce = Number(match[1]);
  return Number.isFinite(bounce) ? clampBounce(bounce) : null;
}

/** Evaluate Studio's deterministic, endpoint-normalized damped-cosine spring. */
export function evaluateSpringEase(progress: number, bounce: number): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;

  const normalizedBounce = clampBounce(bounce);
  const decay = 12 - normalizedBounce * 6;
  const angularFrequency = Math.PI * 2 * (1 + normalizedBounce * 1.5);
  const endpoint = 1 - Math.exp(-decay) * Math.cos(angularFrequency);
  return (1 - Math.exp(-decay * progress) * Math.cos(angularFrequency * progress)) / endpoint;
}
