import type { Schedule } from "../frost";
import { ATTACK, SETTLE } from "./motion";

export const FADE_DURATION = 1.5;
export const DEFAULT_SCHEDULE: Readonly<Schedule> = Object.freeze({
  logoBreak: 1.5,
  form1: 3.8,
  break1: 10.375,
  form2: 12.675,
  break2: 18.5,
  fadeOut: 22,
});
export const durationOf = (s: Schedule) => s.fadeOut + FADE_DURATION;

/** Preserve entered beat times, moving only overlaps forward; never truncate the final break. */
export function resolveSchedule(raw: Schedule, breakDuration: number): Schedule {
  const breakSpan = 0.3 + breakDuration + 0.6;
  const logoBreak = raw.logoBreak;
  const form1 = Math.max(raw.form1, logoBreak + breakSpan);
  const break1 = Math.max(raw.break1, form1 + SETTLE + ATTACK);
  const form2 = Math.max(raw.form2, break1 + breakSpan);
  const break2 = Math.max(raw.break2, form2 + SETTLE + ATTACK);
  const fadeOut = Math.max(raw.fadeOut, break2 + breakSpan);
  return { logoBreak, form1, break1, form2, break2, fadeOut };
}
