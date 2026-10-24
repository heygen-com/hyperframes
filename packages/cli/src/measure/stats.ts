/** Pearson correlation of the first min(len) values, or null under `minN` values or with no variance. */
export function pearson(a: number[], b: number[], minN = 2): number | null {
  const n = Math.min(a.length, b.length);
  if (n < minN) return null;
  const ma = a.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const mb = b.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let [num, da, db] = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    num += (a[i]! - ma) * (b[i]! - mb);
    da += (a[i]! - ma) ** 2;
    db += (b[i]! - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : null;
}

/** yours / ref, with two values both at or under `floor` the same (1): two still or two grey clips match. */
export function ratio(yours: number, ref: number, floor: number): number {
  if (Math.abs(yours) <= floor && Math.abs(ref) <= floor) return 1;
  return yours / (ref || 1e-9);
}
