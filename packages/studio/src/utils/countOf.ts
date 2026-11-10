/** "1 clip", "2 clips": a count with its word, plural only when the count is not 1. */
export function countOf(n: number, word: string): string {
  return `${n} ${n === 1 ? word : `${word}s`}`;
}
