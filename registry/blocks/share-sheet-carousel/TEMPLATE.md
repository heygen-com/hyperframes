# Share-Sheet Carousel editing contract

## Surface ownership

This template depicts an operating-system share sheet. The supplied website is the item or sender shown inside that interface; it does not own the surrounding system UI. The remix is an advertisement for that brand: the sender name, the brand strip, and the wordmark carry its real identity.

## Editable slots

Only defaults declared in `data-composition-variables` are editable:

- `shareTitle`, `senderName`, `itemLabel`, and `stripText`
- `acceptLabel` and `declineLabel`
- `slideImage1` through `slideImage4`; each image also drives its matching blurred background
- `brandLogo`, using a transparent horizontal wordmark

Keep replacement copy within 20% of the original length.

## Safe editing mechanics

Call `set_template_variable_defaults` once with the existing variable ids and their new defaults. Do not directly edit or rewrite `index.html` or its `data-composition-variables` attribute; the imported declaration is HTML-entity-encoded JSON and the setter preserves that encoding. Never edit `__template_baseline__.html` or a duplicate composition file. For an image slot, pass only the token returned by an image tool. Validate after the setter succeeds.

## Protected

Preserve the share-sheet palette, typography, buttons, geometry, carousel layout, scene structure, duration, timing, easing, and tap animation. Do not replace any image outside the declared slide and logo slots, and do not recolor the operating-system interface.
