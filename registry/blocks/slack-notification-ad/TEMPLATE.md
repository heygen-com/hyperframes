# Slack Notification Ad editing contract

## Surface ownership

This template depicts Slack notifications on an iOS lock screen. Slack and iOS own the notification and device chrome. The supplied website appears in the declared notification copy and the final payoff identity, and nowhere else. The remix is an advertisement for that brand: the payoff notification carries its real name and its own mark.

## Editable slots

Only defaults declared in `data-composition-variables` are editable:

- The eleven request titles and messages
- The final payoff title, message, and logo

Keep replacement copy within 20% of the original length. The payoff logo must remain legible in the existing icon tile.

## Safe editing mechanics

Call `set_template_variable_defaults` once with the existing variable ids and their new defaults. Do not directly edit or rewrite `index.html` or its `data-composition-variables` attribute; the imported declaration is HTML-entity-encoded JSON and the setter preserves that encoding. Never edit `__template_baseline__.html` or a duplicate composition file. For the payoff logo, pass only the token returned by an image tool. Validate after the setter succeeds.

## Protected

Preserve the Slack mark on request notifications, iOS status/date/clock labels, wallpaper, notification chrome, fonts, palette, stacking geometry, scene structure, duration, timing, easing, and arrival cadence.

Website colors and typography must never be applied to the Slack or iOS shell.
