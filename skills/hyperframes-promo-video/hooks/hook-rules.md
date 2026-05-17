# Hook Enforcement Rules

These rules apply to the headline text of any `HookTitle` scene. They exist to prevent scroll-past: research shows 65% of viewers who watch the first 3 seconds stay for 10+ seconds, and the hook is the only thing that earns that first 3 seconds.

## Rule 1: Max 7 words

Count whitespace-separated tokens. Reject hooks with more than 7.

- ✓ `"Swap validation libs with one line"` (6 words)
- ✗ `"Introducing our new standard schema interface for validation libraries"` (9 words)

## Rule 2: Blocked openings

Reject hooks whose first phrase matches (case-insensitive):

- `"In this video"`
- `"I'm excited to"`
- `"I am excited to"`
- `"Today we're launching"`
- `"Today we are launching"`
- `"Announcing"`
- `"Introducing"`
- Hook's first word is the product/company name

## Rule 3: Must match one of seven patterns

See `hook-patterns.md`. The hook must map to at least one of: Result, Mistake, Secret, Comparison, Pattern-interrupt, Curiosity-gap, Visual-hook.

## Rule 4: Visual reinforces text

The `HookTitle` scene's `data-visual-variant` attribute (`pattern-interrupt`, `curiosity-gap`, `social-proof`) must align with the hook text.

## Rule 5: Anti-clickbait check

Before render, verify the hook's promise is delivered by at least one non-hook scene. If no delivery scene exists, refuse to render.

## Enforcement Flow

1. Phase 3.3 (scene plan approval): run rules 1, 2, 3, 4 on the proposed hook text.
2. Phase 5 (iteration): re-run rules 1, 2, 3 after every user edit that changes hook text.
3. Phase 6.1 (pre-render): run all 5 rules including rule 5. Block render if any fail.

If a rule fails, the skill proposes up to 3 alternatives that comply.
