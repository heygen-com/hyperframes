# Pattern: bug-fix

## When to Use

- "fix" in PR title
- `bug` label applied
- Linked issue is bug report

## Scene Sequence (30s target)

1. **HookTitle** (0-3s) — Mistake or Pattern-interrupt pattern
2. **BeforeAfter** (3-18s) — broken state vs fixed state
3. **CTAEndScreen** (18-30s) — "Update to vX.Y.Z"

## Code Handling

**Synthesize before/after snippets.** Raw diffs from bug fixes are usually noisy. If the bug is visual, use screenshots instead of code in BeforeAfter.

## Hook Pattern Bias

Strong fit: Mistake, Pattern-interrupt.
Avoid: Result, Comparison, Secret.

## Example

PR: fixes a form focus bug.

- HookTitle: `"Your submit button was lying"` (Pattern-interrupt, 5 words)
- BeforeAfter: left = "click submit → nothing"; right = "click submit → works"
- CTAEndScreen: "Update to 2.1.4"
