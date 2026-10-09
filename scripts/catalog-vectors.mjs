// The embedding model's float output differs slightly between CPUs, so vectors are compared by direction, not bytes.
export const VECTORS = /-vectors\.bin$/;
const MIN_ROW_COSINE = 0.99;

/** Same row count, and every row of Float32 vectors points the same way within MIN_ROW_COSINE. */
export function vectorsAgree(a, b, dimensions) {
  const rowBytes = 4 * dimensions;
  if (a.length !== b.length || a.length % rowBytes !== 0) return false;
  return Array.from({ length: a.length / rowBytes }, (_, row) =>
    rowCosine(a, b, row * rowBytes, (row + 1) * rowBytes),
  ).every((cosine) => cosine >= MIN_ROW_COSINE);
}

function rowCosine(a, b, start, end) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = start; i < end; i += 4) {
    const x = a.readFloatLE(i);
    const y = b.readFloatLE(i);
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  return dot / Math.sqrt(normA * normB);
}
