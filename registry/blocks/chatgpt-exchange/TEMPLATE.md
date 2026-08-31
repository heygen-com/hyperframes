# ChatGPT Exchange editing contract

## Surface ownership

This template depicts the ChatGPT application. OpenAI owns the surrounding application identity. The supplied website is the subject discussed inside the conversation, never the application around it. The remix is an advertisement for that brand: it takes the recommended first row under its real name, and the remaining rows name real competing products.

## Editable slots

Only defaults declared in `data-composition-variables` are editable:

- The user prompt and two response-introduction paragraphs
- The three comparison-table headings
- The use case, tool, explanation, and source-chip copy for each of four rows

Typed and streamed copy is length-locked to within 20% of the original.

## Safe editing mechanics

Call `set_template_variable_defaults` once with the existing variable ids and their new defaults. Do not directly edit or rewrite `index.html` or its `data-composition-variables` attribute; the imported declaration is HTML-entity-encoded JSON and the setter preserves that encoding. Never edit `__template_baseline__.html` or a duplicate composition file. Validate after the setter succeeds.

## Protected

Preserve the ChatGPT name, labels, suggestions, predictive keyboard text, header, composer, keyboard, icons, fonts, palette, layout, status UI, table geometry, scene structure, duration, timing, easing, typing cadence, and reveal behavior.

Website colors and typography must never be applied to the ChatGPT shell. If a requested value has no declared variable, leave it unchanged.
