export const DEFAULT_VP9_CPU_USED = 4;
export const MIN_VP9_CPU_USED = -8;
export const MAX_VP9_CPU_USED = 8;

export function normalizeVp9CpuUsed(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_VP9_CPU_USED;
  const integer = Math.trunc(value);
  return Math.max(MIN_VP9_CPU_USED, Math.min(MAX_VP9_CPU_USED, integer));
}

export function appendVp9CpuUsedArg(args: string[], value: number | undefined): void {
  args.push("-cpu-used", String(normalizeVp9CpuUsed(value)));
}
