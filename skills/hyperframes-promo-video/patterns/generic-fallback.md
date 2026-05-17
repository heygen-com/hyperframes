# Pattern: generic-fallback

## When to Use

No other pattern detected: infrastructure changes, bundled releases, doc overhauls, or user explicitly picks this.

## Scene Sequence (30s target)

1. **HookTitle** (0-3s) — Curiosity-gap or Result
2. **BulletList** (3-25s) — 3 key changes, revealed one at a time
3. **CTAEndScreen** (25-30s)

## Code Handling

No code by default. If one specific change has a compelling snippet, insert a single `CodeSnippet` scene between the bullets.

## Hook Pattern Bias

Curiosity-gap tends to work best for mixed releases.

## Example

PR: v3 release with new docs, new CLI, new plugin API.

- HookTitle: `"Three reasons to upgrade today"` (Curiosity-gap, 5 words)
- BulletList: "New docs. New CLI. Plugin API."
- CTAEndScreen: "Upgrade to v3."
