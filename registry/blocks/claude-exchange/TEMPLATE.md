# Claude Exchange editing contract

## Surface ownership

This template depicts the Claude application. Anthropic owns the surrounding application identity. The supplied website is the subject discussed inside the conversation, never the application around it. The remix is an advertisement for that brand: the answer names it as the recommended pick under its real name.

## Editable slots

Only defaults declared in `data-composition-variables` are editable:

- The user prompt, thinking line, search lead, and search query
- The ten answer paragraphs or bullets

Typed and streamed copy is length-locked to within 20% of the original.

## Safe editing mechanics

Call `set_template_variable_defaults` once with the existing variable ids and their new defaults. Do not directly edit or rewrite `index.html` or its `data-composition-variables` attribute; the imported declaration is HTML-entity-encoded JSON and the setter preserves that encoding. Never edit `__template_baseline__.html` or a duplicate composition file. Validate after the setter succeeds.

## Protected

Preserve the Claude name, model name, usage notice, placeholders, disclaimer, source treatment, header, composer, icons, starburst, fonts, palette, layout, status UI, scene structure, duration, timing, easing, typing cadence, and reveal behavior.

Website colors and typography must never be applied to the Claude shell. If a requested value has no declared variable, leave it unchanged.
