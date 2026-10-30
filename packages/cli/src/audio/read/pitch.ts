export { pitchTrack, type PitchPoint } from "@hyperframes/core/audio-analysis";
import type { PitchPoint } from "@hyperframes/core/audio-analysis";

export function within(track: readonly PitchPoint[], start: number, end: number): number[] {
  let lo = 0;
  let hi = track.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (track[mid]!.t < start) lo = mid + 1;
    else hi = mid;
  }
  const out: number[] = [];
  for (let i = lo; i < track.length && track[i]!.t < end; i++) out.push(track[i]!.hz);
  return out;
}

export const semitones = (a: number, b: number) => 12 * Math.log2(a / b);
