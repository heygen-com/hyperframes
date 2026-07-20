/** Parse a user satisfaction score on the 1–10 feedback scale. */
export function parseFeedbackRating(raw: string): number | null {
  const n = parseInt(raw, 10);
  return n >= 1 && n <= 10 && Number.isFinite(n) ? n : null;
}
