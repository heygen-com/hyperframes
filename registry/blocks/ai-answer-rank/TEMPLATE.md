# AI Answer Rank editing contract

## Surface ownership

This is a generic assistant answer card, not any real AI product. The website brand is the subject of the ranking: the `brand` slot carries its real name, and the re-rank moves it into the answer with the one accent highlight. The other picks are competitors, never the brand itself. The chat card and motion remain template-owned.

## Editable slots

Only defaults declared in `data-composition-variables` are editable:

- `prompt` and `lead`
- `rowA`, `rowB`, and `rowC`, the original picks
- `brand` and `brandRank`, the slot the brand lands in
- `accent`, `ink`, and `ground`

Typed copy is length-locked to within 20% of the original. Pick and brand names stay short enough to fit one row.

## Safe editing mechanics

Call `set_template_variable_defaults` once with the existing variable ids and their new defaults. Do not directly edit or rewrite `index.html` or its `data-composition-variables` attribute; the imported declaration is HTML-entity-encoded JSON and the setter preserves that encoding. Never edit `__template_baseline__.html` or a duplicate composition file. Validate after the setter succeeds.

## Protected

Do not change the card chrome, monogram tiles, skeleton rules, layout, fonts, scene order, duration, timing, easing, typing cadence, or re-rank logic. Website colors may only reach the declared `accent`, `ink`, and `ground` slots; keep `ink` legible on `ground`. If a requested value has no declared variable, leave it unchanged.
