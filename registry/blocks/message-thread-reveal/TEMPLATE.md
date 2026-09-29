# Message Thread Reveal editing contract

## Surface ownership

This template depicts a phone messaging interface. The supplied website is the subject of the conversation, shared link, and closing card; it does not own the messaging application chrome. The remix is an advertisement for that brand: the shared link card and the closing card carry its real name and its real domain.

## Editable slots

Only defaults declared in `data-composition-variables` are editable:

- `contactName`
- The complete conversation: `questionMessage`, `teaserMessage`, `reactionMessage`, `reactionEmoji`, `benefitMessage`, `discoveryMessage`, `sourceMessage`, `workflowMessage`, `ownershipMessage`, `installMessage`, and `thanksMessage`
- The shared link: `cardImage`, `cardTitle`, and `cardDomain`
- The closing card: `brandLogo`, `ecProof`, `ecFeature1` through `ecFeature3`, and `ecCta`

Keep replacement copy within 20% of the original length.

## Safe editing mechanics

Call `set_template_variable_defaults` once with the existing variable ids and their new defaults. Do not directly edit or rewrite `index.html` or its `data-composition-variables` attribute; the imported declaration is HTML-entity-encoded JSON and the setter preserves that encoding. Never edit `__template_baseline__.html` or a duplicate composition file. For an image slot, pass only the token returned by an image tool. Validate after the setter succeeds.

## Protected

Preserve messaging chrome, bubble styling, receipts, palette, typography, geometry, scene structure, duration, timing, easing, and reveal behavior. Do not replace any image outside the declared link-card and closing-card logo slots, and do not recolor the messaging interface to match the supplied website.
