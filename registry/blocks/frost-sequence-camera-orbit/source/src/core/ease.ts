export const expoInOut = (x: number) =>
  x <= 0
    ? 0
    : x >= 1
      ? 1
      : x < 0.5
        ? Math.pow(2, 20 * x - 10) / 2
        : (2 - Math.pow(2, -20 * x + 10)) / 2;
export const expoOut = (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
export const smooth = (x: number) => x * x * (3 - 2 * x);
export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** Frame-rate independent exponential smoothing toward `target` with time constant `tau` (seconds). */
export const damp = (cur: number, target: number, tau: number, dt: number) =>
  tau <= 0 ? target : cur + (target - cur) * (1 - Math.exp(-dt / tau));
