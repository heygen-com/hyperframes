# Notification Cascade editing contract

## Surface ownership

This is a generic notification presentation with a HyperFrames-branded payoff. The notification geometry, backdrop, stacking behavior, typography, and motion belong to the template. The supplied website is the subject brand placed into declared slots. The remix is an advertisement for that brand, so its real name, its real domain, and its own mark belong in the declared identity slots.

## Editable slots

Only defaults declared in `data-composition-variables` are editable:

- `notifTitle`, `message1` through `message4`, and `appName`
- `headlineTop`, `headlineAccent`, and `footerText`
- `brandLogo`, using a transparent mark that remains legible on the dark closing card

Keep replacement copy within 20% of the original length.

## Safe editing mechanics

Call `set_template_variable_defaults` once with the existing variable ids and their new defaults. Do not directly edit or rewrite `index.html` or its `data-composition-variables` attribute; the imported declaration is HTML-entity-encoded JSON and the setter preserves that encoding. Never edit `__template_baseline__.html` or a duplicate composition file. For an image slot, pass only the token returned by an image tool. Validate after the setter succeeds.

## Protected

Do not change CSS, layout, backdrop, notification chrome, scene structure, duration, timing, easing, stacking, or reveal behavior. Do not replace any image outside the declared closing-card logo slot. Colors are protected because this template declares no color variables.
