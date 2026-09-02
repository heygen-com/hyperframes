# Notes Reveal editing contract

## Surface ownership

This template depicts a notes application and a hand-lettered checklist. The supplied website provides the declared note and checklist copy; it does not own the notes application chrome. The remix is an advertisement for that brand, and the sign-off strip under the closing card is where that brand is identified: place its real mark in `brandLogo` and its real domain in `brandDomain`.

**The seven note body lines are the video.** They are typed out over the first 20 of 24.9 seconds and are the only place the note says anything, so they carry the pitch. The packaged defaults tell HyperFrames' own story — "my videos sucked", "started HyperFrames three weeks ago" — and every one of them must be rewritten for the brand being advertised. Leaving them is shipping HyperFrames' marketing inside somebody else's ad.

Write them as one person's note, in the first person, arcing from a problem to this brand solving it: three lines of the problem, a turn where the brand enters, then the payoff. Use the brand's own language from the captured page, in the language of that page.

## Editable slots

Only defaults declared in `data-composition-variables` are editable:

- `noteLine1` through `noteLine7` — the typed note body, the substance of the ad
- `titleL1` and `titleL2` — the note's title, two lines
- `cardTop`, `cardMid`, `cardBottom` — the three hand-lettered lines of the closing card. `cardTop`'s last word gets the underline and `cardBottom`'s first word gets the ring, so put the word worth emphasising in those positions. `cardMid` is a short connector ("OF", "FOR", "VOOR"): keep it to one or two words.
- `check1Label` through `check3Label`
- `check1Value` through `check3Value`
- `brandLogo` and `brandDomain` — the sign-off strip. `brandLogo` takes a transparent mark; leave it at its packaged default rather than substituting a nav icon or a generated image when no real mark is available, since an unidentified sign-off is better than a wrong one.

Length is not locked. Every text slot is fitted to its box at render time, shrinking the type only as far as it must and never past the designed size, so a value the length of the default renders exactly as drawn and a longer one still stays inside the card or the note. The declared character caps are only a backstop for absurd input. Typing speed adapts to the line: each body line is revealed inside the same frame window the packaged copy used, so the note always finishes before the card appears and the composition stays 24.867s whatever you write.

## Safe editing mechanics

Call `set_template_variable_defaults` once with the existing variable ids and their new defaults. Do not directly edit or rewrite `index.html` or its `data-composition-variables` attribute; the imported declaration is HTML-entity-encoded JSON and the setter preserves that encoding. Never edit `__template_baseline__.html` or a duplicate composition file. Validate after the setter succeeds.

## Protected

Preserve notes chrome, paper treatment, fonts, colors, checklist geometry, sign-off strip geometry, scene structure, duration, timing, easing, handwriting motion, and reveal cadence.
