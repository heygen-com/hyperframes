#!/usr/bin/env tsx
/**
 * Render Benchmark
 *
 * Runs each test fixture multiple times and records per-stage timing
 * plus peak heap/RSS memory. Results are saved to
 * producer/tests/perf/benchmark-results.json.
 *
 * Usage:
 *   bun run benchmark                    # 3 runs per fixture (default)
 *   bun run benchmark -- --runs 5        # 5 runs per fixture
 *   bun run benchmark -- --only chat     # single fixture
 *   bun run benchmark -- --exclude-tags slow
 *   bun run benchmark -- --tags hdr      # only fixtures tagged "hdr"
 *   bun run bench:hdr                    # convenience: --tags hdr
 *
 * `--tags` and `--exclude-tags` may be passed together; a fixture must match
 * at least one positive tag (when `--tags` is provided) AND must not match
 * any excluded tag.
 */
export {};
//# sourceMappingURL=benchmark.d.ts.map