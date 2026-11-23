/** A long computation that yields between short pieces of work, so a caller can pause it. */
export type Steps<T> = Generator<void, T, void>;

export function finish<T>(steps: Steps<T>): T {
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}
