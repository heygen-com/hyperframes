export const FEEDBACK_RATING_SCALE = 10;

export function parseFeedbackRating(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const rating = Number(trimmed);
  return Number.isInteger(rating) && rating >= 0 && rating <= FEEDBACK_RATING_SCALE ? rating : null;
}
