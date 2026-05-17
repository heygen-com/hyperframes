# Pattern: performance-win

## When to Use

- PR title contains perf keywords (ms, throughput, speedup, faster, Nx, N%)
- Benchmarks added or improved
- Bundle size reductions

## Scene Sequence (30s target)

1. **HookTitle** (0-3s) — Result pattern heavily preferred (specific number in the hook)
2. **ProblemSetup** (3-8s) — why old performance mattered
3. **MetricCompare** (8-18s) — before/after numbers, large typography
4. **CodeSnippet** (18-25s, optional) — the one-line change that did it, if applicable
5. **CTAEndScreen** (25-30s)

## Code Handling

Optional code scene only if the performance win can be attributed to a simple config change or one-line code change.

## Hook Pattern Bias

Strong fit: Result with a specific number, Comparison.
Avoid: Curiosity-gap.

## Example

PR: rewrites the bundler to be 10x faster.

- HookTitle: `"Ten times faster builds"` (Result, 4 words)
- ProblemSetup: "Every save, a 3-second wait"
- MetricCompare: "3.2s → 0.3s" with large typography, colored bars
- CTAEndScreen: "Upgrade now."
