/** Integer rates the distributed renderer (Lambda, Cloud Run) accepts; fractional fps renders in-process only. */
export const DISTRIBUTED_FPS = [24, 25, 30, 60] as const;
export type DistributedFps = (typeof DISTRIBUTED_FPS)[number];

export function isDistributedFps(value: unknown): value is DistributedFps {
  return (DISTRIBUTED_FPS as readonly unknown[]).includes(value);
}
