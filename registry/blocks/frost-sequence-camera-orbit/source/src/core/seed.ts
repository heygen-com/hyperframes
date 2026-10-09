/** Deterministic PRNG (mulberry32) seeded from the DialKit `seed`. */
export function rng(seed: number) {
  let a = (seed * 1664525 + 1013904223) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
