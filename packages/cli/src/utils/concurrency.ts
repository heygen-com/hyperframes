/** Runs `worker` over `inputs` with at most `limit` in flight. Results keep input order, and the
 * first rejection rejects the run. */
export async function runWithConcurrencyLimit<T, R>(
  inputs: readonly T[],
  limit: number,
  worker: (input: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (limit < 1) throw new Error(`runWithConcurrencyLimit: limit must be ≥ 1, got ${limit}`);
  const results = new Array<R>(inputs.length);
  let cursor = 0;
  const workerCount = Math.min(limit, inputs.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < inputs.length) {
        const idx = cursor++;
        results[idx] = await worker(inputs[idx]!, idx);
      }
    }),
  );
  return results;
}
