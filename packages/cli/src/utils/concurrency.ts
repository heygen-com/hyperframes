/** Runs `worker` over `inputs` with at most `limit` in flight. Results keep input order. After the first
 * rejection no new input starts, and the run rejects with it once the work already started has finished. */
export async function runWithConcurrencyLimit<T, R>(
  inputs: readonly T[],
  limit: number,
  worker: (input: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (limit < 1) throw new Error(`runWithConcurrencyLimit: limit must be ≥ 1, got ${limit}`);
  const results = new Array<R>(inputs.length);
  let cursor = 0;
  let failed = false;
  const workerCount = Math.min(limit, inputs.length);
  const settled = await Promise.allSettled(
    Array.from({ length: workerCount }, async () => {
      while (!failed && cursor < inputs.length) {
        const idx = cursor++;
        try {
          results[idx] = await worker(inputs[idx]!, idx);
        } catch (error) {
          failed = true;
          throw error;
        }
      }
    }),
  );
  const rejected = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
  if (rejected) throw rejected.reason;
  return results;
}
