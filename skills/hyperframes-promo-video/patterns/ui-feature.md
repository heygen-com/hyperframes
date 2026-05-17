# Pattern: ui-feature

## When to Use

- New UI component, page, layout, or theme
- Visual redesign
- New interaction pattern

## Scene Sequence (30s target)

1. **HookTitle** (0-3s) — Result or Pattern-interrupt bias
2. **BeforeAfter** (3-15s) — screenshots / mock components; old UX vs new UX
3. **BulletList** (15-25s) — 3 key benefits
4. **CTAEndScreen** (25-30s)

## Code Handling

**No code scenes** by default. If the feature includes an API surface, consider one `CodeSnippet` scene between BeforeAfter and BulletList.

## Hook Pattern Bias

Strong fit: Result, Pattern-interrupt, Mistake.
Weaker fit: Comparison, Curiosity-gap.

## Example

PR: new command palette component with fuzzy search.

- HookTitle: `"Every action, one keystroke"` (Result, 4 words)
- BeforeAfter: old nested menu vs command palette (cmd-K + 3 chars)
- BulletList: "Fuzzy match. Keyboard-first. Theme-aware."
- CTAEndScreen: "Try it. Cmd-K."
