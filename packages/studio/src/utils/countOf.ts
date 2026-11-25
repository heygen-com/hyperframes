export function countOf(n: number, word: string): string {
  return `${n} ${n === 1 ? word : `${word}s`}`;
}
