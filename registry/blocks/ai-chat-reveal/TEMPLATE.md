# AI Chat Reveal editing contract

## Surface ownership

This is a generic assistant conversation followed by a brandable closing card. The website brand appears in the declared conversation and closing-card slots; the chat shell and motion remain template-owned. The remix is an advertisement for that brand: the closing card carries its real name, its real domain, and its own mark, while the assistant answering in the conversation keeps its own name.

## Editable slots

Only defaults declared in `data-composition-variables` are editable:

- `botName`, `userMessage`, `answer1` through `answer3`
- `bullet1` through `bullet3`
- `ecHeadline`, `ecSub`, `ecCta`, and `ecFooter`
- `brandLogo`, using a transparent mark that remains legible on the dark header

Typed and streamed copy is length-locked to within 20% of the original.

## Safe editing mechanics

Call `set_template_variable_defaults` once with the existing variable ids and their new defaults. Do not directly edit or rewrite `index.html` or its `data-composition-variables` attribute; the imported declaration is HTML-entity-encoded JSON and the setter preserves that encoding. Never edit `__template_baseline__.html` or a duplicate composition file. For an image slot, pass only the token returned by an image tool. Validate after the setter succeeds.

## Protected

Do not change chat chrome, keyboard, layout, palette, fonts, scene order, duration, timing, easing, typing cadence, or reveal logic. Do not replace any image outside the declared closing-card logo slot, and do not restyle the assistant interface to match the supplied website. This contract declares no color variables.
