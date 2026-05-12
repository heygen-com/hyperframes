/**
 * Transparency Regression Test
 *
 * Exercises the alpha-output pipelines (webm + png-sequence) end-to-end
 * against `tests/transparency-regression/`. Asserts that:
 *
 *   1. Pixels that were transparent in the browser stay transparent in the
 *      output (alpha = 0).
 *   2. Pixels covered by the opaque red `.card` element stay fully opaque
 *      (alpha = 255) and keep their red color.
 *
 * This is intentionally NOT wired into `regression-harness.ts` — the harness
 * compares each fixture against a golden MP4, but transparency requires a
 * different validation strategy (pixel inspection of the alpha channel). Run
 * this script via `bun run --filter @hyperframes/producer test:transparency`
 * or directly via `tsx src/transparency-test.ts` from this package.
 */
export {};
//# sourceMappingURL=transparency-test.d.ts.map