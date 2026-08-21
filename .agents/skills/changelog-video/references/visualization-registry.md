# Visualization Registry

The routing table for "show, don't tell". Classes, strongest first:

1. **ui-recreate** — the change lives in a surface we can faithfully mock.
2. **ui-analog** — no exact surface, but an honest UI metaphor exists
   (panel, meter, pipeline) whose behavior IS the change.
3. **terminal** — the change is a CLI command/flag; type it, show the result.
4. **checklist** — non-visual (fix lists, dependency bumps). Last resort.

Never invent UI that implies a screen that doesn't exist — an analog must
depict the _behavior_ (speed, batching, caching), not a fake product page.

## Known surfaces (ui-recreate)

| Surface                      | Mock anatomy                                                                                                                                            | Proven choreography                                                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Studio editor / timeline** | glass app frame: titlebar (traffic dots, mono app name, Export pill), preview strip w/ gradient art, ruler + ticks, lanes, playhead, mono-labeled clips | clips drop/stack into lanes; drag→edge/playhead snap w/ green snap-line flash; marquee → group move → group resize; playhead scrub drives preview art (hue-rotate) |
| **Inspector / design panel** | panel: MONO section headers (INSPECTOR / VARIABLES), key-value rows, hairline dividers, dashed empty slot                                               | binding pill (`{{ var }}`) flies into a property slot; value swap via masked slide (old up-out, new up-in); selection box draws on canvas                          |
| **Canvas + element**         | mini stage card, dashed selection box, live text element                                                                                                | text updates same-frame with panel edits (green underline pulse = the live-preview moment)                                                                         |
| **Variant renders**          | small cards: display-font title + mono filename                                                                                                         | cascade out diagonally, stagger ≤0.15s                                                                                                                             |
| **Storyboard view**          | row of scene thumbnails w/ mono scene labels                                                                                                            | thumbnails file in as a waterfall; one gets dragged to reorder                                                                                                     |
| **Terminal / CLI**           | glass strip, mono 19-20px, `$ ` prompt dim                                                                                                              | chars type (stagger .02), result line lands after a 0.3-0.5s beat                                                                                                  |
| **Render panel**             | RENDER header, big tabular-nums frame counter, progress bar (green fill = the moment), status chips                                                     | bar + counter run with `power2.in` (slow→fast reads as "faster"); chips land on their VO words                                                                     |

## Proven analogs (ui-analog)

| Change type                                  | Analog                                                                                                                               | Behavior                                                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Color grading / LUT                          | slider rows (label + track + knob) beside footage art                                                                                | each knob move re-filters the art SAME frame (causal)                                                                       |
| Render/extraction speed                      | render panel counter + bar                                                                                                           | ease tells the story; add a before/after time chip if the claim is numeric                                                  |
| Batching (frames, requests)                  | row of small ticks                                                                                                                   | brackets draw around groups; ticks nudge into clusters                                                                      |
| Caching                                      | two identical request rows                                                                                                           | first row runs a full bar; second short-circuits instantly to ✓ with a `cache` chip                                         |
| Import/translation pipelines (e.g. Figma→HF) | source artifact card morphs/docks into a HF comp card — a pure DOM/CSS mock of the source (NO Figma API, no tokens, nothing fetched) | staged: source card → arrow/flight of extracted chips (tokens, components, motion) → assembled comp; chips are the carriers |
| One-pass / dedupe                            | N parallel item rows collapse onto one shared lane                                                                                   | rows glide onto one bar; count chip decrements                                                                              |
| Concurrency caps / locks                     | queue of chips entering a gate                                                                                                       | first k pass, rest hold; gate chip shows the cap                                                                            |
| Error surfacing (toast, reason)              | the surface's corner grows a toast card                                                                                              | action fails subtly → toast slides in, mono reason text                                                                     |

## Checklist scene (last resort)

Glass card, ≤6 mono rows, green ✓ ticks landing on each item's VO word
(back.out(1.5), 0.3s) + row brightness pulse. Items beyond 6: cut, they live
in the digest link.

## Adding a surface

When a new UI area ships, add a row here (anatomy + choreography) the first
time it's mocked, so the next changelog reuses it instead of re-deriving it.
