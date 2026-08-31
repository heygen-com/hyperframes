# Notes Reveal editing contract

## Surface ownership

This template depicts a notes application and a hand-lettered checklist. The supplied website provides the declared note and checklist copy; it does not own the notes application chrome. The remix is an advertisement for that brand, but this template declares no name, domain, or logo slot: the brand can only come through in the note and checklist copy, and there is nowhere to place its mark.

## Editable slots

Only defaults declared in `data-composition-variables` are editable:

- `titleL1`, `titleL2`, and `cardTop`
- `check1Label` through `check3Label`
- `check1Value` through `check3Value`

Typed copy is length-locked to within 20% of the original.

## Safe editing mechanics

Call `set_template_variable_defaults` once with the existing variable ids and their new defaults. Do not directly edit or rewrite `index.html` or its `data-composition-variables` attribute; the imported declaration is HTML-entity-encoded JSON and the setter preserves that encoding. Never edit `__template_baseline__.html` or a duplicate composition file. Validate after the setter succeeds.

## Protected

Preserve notes chrome, paper treatment, fonts, colors, checklist geometry, scene structure, duration, timing, easing, handwriting motion, and reveal cadence.
