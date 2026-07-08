import type { ClassificationNote, CodemodStatus } from "./types.ts";

export function note(code: string, message = code): ClassificationNote {
  return { code, message };
}

export function addUniqueNote(notes: ClassificationNote[], next: ClassificationNote): void {
  if (notes.some((note) => note.code === next.code)) return;
  notes.push(next);
}

export function statusFor(
  reasons: ClassificationNote[],
  warnings: ClassificationNote[],
): CodemodStatus {
  if (reasons.length > 0) return "manual";
  if (warnings.length > 0) return "converted-with-warnings";
  return "converted";
}

export function mergeNotes(groups: ClassificationNote[][]): ClassificationNote[] {
  const merged: ClassificationNote[] = [];
  for (const group of groups) {
    for (const entry of group) addUniqueNote(merged, entry);
  }
  return merged;
}
