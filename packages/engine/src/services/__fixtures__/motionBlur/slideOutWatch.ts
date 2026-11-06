export interface Shot {
  hash: string;
  clockBefore: number;
  clockAfter: number;
}

export interface SlideOut {
  startS: number;
  endS: number;
}

export const advancedOf = (shots: readonly Shot[]): number => shots.at(-1)?.clockAfter ?? 0;
export const distinctOf = (shots: readonly Shot[]): number =>
  new Set(shots.map((s) => s.hash)).size;

export function newFramesIn(shots: readonly Shot[], { startS, endS }: SlideOut): number {
  const held = new Set(shots.filter((s) => s.clockAfter < startS).map((s) => s.hash));
  const inside = shots.filter((s) => s.clockBefore >= startS && s.clockAfter < endS);
  return new Set(inside.filter((s) => !held.has(s.hash)).map((s) => s.hash)).size;
}

export const slideOutWatched = (shots: readonly Shot[], slideOut: SlideOut): boolean =>
  newFramesIn(shots, slideOut) > 0 || advancedOf(shots) >= slideOut.endS;
