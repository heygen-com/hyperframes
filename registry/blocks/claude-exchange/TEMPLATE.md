# Claude Exchange editing contract

## Surface ownership

This template depicts the Claude application. Anthropic owns the surrounding application identity. The supplied website is only the subject discussed inside the conversation.

## Editable slots

Only defaults declared in `data-composition-variables` are editable:

- The user prompt, thinking line, search lead, and search query
- The ten answer paragraphs or bullets

Typed and streamed copy is length-locked to within 20% of the original.

## Protected

Preserve the Claude name, model name, usage notice, placeholders, disclaimer, source treatment, header, composer, icons, starburst, fonts, palette, layout, status UI, scene structure, duration, timing, easing, typing cadence, and reveal behavior.

Website colors and typography must never be applied to the Claude shell. If a requested value has no declared variable, leave it unchanged.
