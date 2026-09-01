# Notes Reveal editing contract

## Surface ownership

This template depicts a notes application and a hand-lettered checklist. The supplied website provides the declared note and checklist copy; it does not own the notes application chrome. The remix is an advertisement for that brand, and the sign-off strip under the closing card is where that brand is identified: place its real mark in `brandLogo` and its real domain in `brandDomain`. The note and checklist copy is the creative hook, not the attribution — do not put a brand name into `cardTop`, whose marker line continues into the fixed words "OF ONE FILE".

## Editable slots

Only defaults declared in `data-composition-variables` are editable:

- `titleL1`, `titleL2`, and `cardTop`
- `check1Label` through `check3Label`
- `check1Value` through `check3Value`
- `brandLogo` and `brandDomain` — the sign-off strip. `brandLogo` takes a transparent mark; leave it at its packaged default rather than substituting a nav icon or a generated image when no real mark is available, since an unidentified sign-off is better than a wrong one.

Typed copy is length-locked to within 20% of the original.

## Safe editing mechanics

Call `set_template_variable_defaults` once with the existing variable ids and their new defaults. Do not directly edit or rewrite `index.html` or its `data-composition-variables` attribute; the imported declaration is HTML-entity-encoded JSON and the setter preserves that encoding. Never edit `__template_baseline__.html` or a duplicate composition file. Validate after the setter succeeds.

## Protected

Preserve notes chrome, paper treatment, fonts, colors, checklist geometry, sign-off strip geometry, scene structure, duration, timing, easing, handwriting motion, and reveal cadence.
