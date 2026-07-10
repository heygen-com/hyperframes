# Minimal Grouped-Control Rail

## Context

The current `toggle-group`, `button-group`, and `menubar` share a heavy segmented-control treatment: a rounded perimeter, an inset surface, and a filled active segment. That nested chrome reads as generic and overly constructed beside the quieter Operator Black primitives.

## Decision

Use a single open rail for all three components. The group has no perimeter, container fill, inset shadow, or rounded shell. A 1px neutral bottom rule is the only shared structure. Selection is communicated by stronger text and a precise 2px accent line aligned to that rule.

This is direction A from the grouped-control comparison. It preserves the useful sense of one control while removing the card-like frame. Direction B was rejected because independent labels weaken group legibility. Direction C was rejected because its tonal field retains too much container chrome.

## Scope

Apply the treatment only to the feature-branch primitives that currently share this motif:

- `toggle-group`
- `button-group`
- `menubar`

Update each canonical component, demo, and generated registry payload required to keep the repository synchronized. Do not restyle standalone `toggle`, `tabs`, `navigation-menu`, `pagination`, or any other primitive as part of this change.

## Visual treatment

### Shared group surface

- Remove the outer border on every side except the bottom rail.
- Remove shell radius, surface fill, inset shadow, and padding whose only purpose is to construct the shell.
- Render one 1px bottom rail with the existing neutral border token.
- Keep the rail visually flat: no gradient, glow, bevel, inner divider, or active plate.
- Preserve a 40px visual control height. Coarse-pointer effective targets remain at least 44px.
- Use compact, even horizontal spacing and keep labels on one line. The four-item menubar must fit its existing compact demo width without horizontal scrolling.

### Selection

- Selected text uses the strong foreground token; unselected text uses the muted foreground token.
- The selected item receives a 2px mint accent line at the bottom edge.
- The accent line must meet the neutral rail cleanly and occupy the selected item width.
- Selected items receive no background fill, rounded rectangle, border box, glow, or shadow.

### Component details

- `toggle-group`: retain the existing `--hf-toggle-index` state contract and sliding indicator architecture. Reduce the indicator to the 2px bottom line and move it between equal-width segments.
- `button-group`: show the accent line on `[aria-pressed="true"]`; remove active fill and elevation.
- `menubar`: show the accent line on `[aria-current="page"]`; remove the outer field and selected-item fill. Keep the item row unwrapped.

## Interaction and motion

- Do not add decorative motion.
- The `toggle-group` indicator continues to move with the existing 160ms response curve.
- Text-color transitions may use the existing short response timing.
- Preserve the existing restrained press feedback and keyboard behavior.
- Focus remains a visible 2px accent outline with 3px offset. It must not be clipped by the rail or component bounds.
- Respect `prefers-reduced-motion` and forced-colors behavior already established by the primitives.

## Contracts and accessibility

- Preserve DOM structure, public attributes, events, CSS custom properties, and ARIA semantics.
- Maintain dark and light theme support through existing semantic tokens.
- Active state cannot depend on color alone: the 2px line and stronger text weight/contrast must remain distinguishable.
- Maintain keyboard traversal, visible focus, and minimum coarse-pointer target sizing.

## Verification

- Run registry synchronization, contract, style, and preview tests for the three components.
- Exercise keyboard focus and selection in both themes.
- Check widths 280, 360, 640, 1024, and 1920px, plus 200% and 400% zoom.
- Check coarse-pointer sizing, reduced motion, and forced colors.
- Run the pinned browser verifier for the affected primitives.
- Regenerate and verify the complete 66-primitive frame lock because these visual hashes intentionally change.

## Acceptance criteria

- None of the three components has a rounded perimeter, framed surface, or filled active segment.
- Each component reads as one coherent control through a single neutral bottom rail.
- Selection is expressed only through stronger text and the 2px mint active edge.
- The result feels visually consistent with the flatter `tabs` and `navigation-menu` language without changing those primitives.
- Semantics, interaction contracts, responsive behavior, and accessibility checks remain intact.
