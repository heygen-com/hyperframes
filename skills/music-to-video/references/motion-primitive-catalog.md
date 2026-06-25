# Motion-primitive catalog — the free-compose menu

The atomic layer: one anchor → one micro-move. When no template fits a group, free-compose by
naming primitives from here. Scan **anchor** + **best span** + **what it does**, then pick the
smallest set that carries the group.

## Timing & latency (applies to every primitive)

- **Hard hits are 0ms.** Cuts, palette flips, content swaps, freezes are `tl.set(...)` with no duration — the percussion _is_ the motion. Easing a hit kills it.
- **Lead the anchor.** A move that must _land_ on a beat (a wipe covering the frame, a count-up locking, two blocks colliding) starts **~40–190ms early** so it completes ON the anchor. Reactive entrances (something appearing _because_ of the hit) fire 0–45ms after.
- **Eased entrances: 300–500ms** (scale punch, slides, camera pushes). **Macro builds: 800–2000ms** spanning a whole roll / silence.
- **Per-bar caps:** one accumulating element per hit (not a burst); a camera move at most once per phrase, never per beat; a dense flip/strobe system runs ≤2–3s.
- **Tension-builds lock.** A count-up / sequential build / morph must _resolve on_ a downbeat or hard_stop, never trail off mid-bar.
- **Best span means active motion.** The catalog's span guidance is not a license to stretch one primitive over a whole frame. If a free-composed group runs longer than the listed span, add a hold / bed / next primitive, or split the frame into another group at the next musical anchor.

## Catalog

| id                    | anchor                           | best span         | what it does                                                              |
| --------------------- | -------------------------------- | ----------------- | ------------------------------------------------------------------------- |
| `hypercut-whip`       | beat / hard_stop                 | 0.18-0.45s        | fast whip-pan hard cut between frames                                     |
| `kinetic-letter-in`   | downbeat / phrase                | 0.4-1.2s          | per-letter kinetic entrance                                               |
| `braam-punch`         | drop / surge                     | 0.2-0.9s active   | big impact: scale + weight slam                                           |
| `chromatic-split`     | snare / glitch / surge           | 0.1-0.6s          | RGB channel split / glitch on a word                                      |
| `mask-reveal`         | section_start / downbeat         | 0.5-1.2s          | clip-path mask wipe reveal                                                |
| `screen-shake`        | drop / crash / kick              | 0.1-0.5s          | camera / screen shake jitter                                              |
| `binary-decrypt`      | roll / build                     | 0.8-2.5s          | scramble→decode text (binary → word)                                      |
| `dolly-zoom`          | phrase / build                   | 1.2-2.5s          | vertigo dolly-zoom (scale vs perspective)                                 |
| `iris-open`           | section_start / reveal           | 0.6-1.2s          | circular iris-open reveal                                                 |
| `electric-arc`        | accent / glitch                  | 0.1-0.6s          | electric arc / lightning accent                                           |
| `neon-flicker`        | hold / texture                   | 0.5-2.5s          | neon-sign flicker                                                         |
| `chrome-sweep`        | downbeat / reveal                | 0.6-1.4s          | metallic specular sweep across text                                       |
| `slot-machine-reveal` | roll → downbeat                  | 0.8-2.0s          | slot-machine spin-to-land character reveal                                |
| `liquid-morph`        | phrase / transition              | 1.0-2.5s          | liquid / blob morph                                                       |
| `gooey-metaball`      | build / drop                     | 1.5-3.0s          | gooey metaball merge field                                                |
| `3d-card-flip`        | downbeat / swap                  | 0.8-1.6s          | 3D card flip (rotateY)                                                    |
| `crash-zoom-in`       | drop / surge                     | 0.2-0.8s          | violent crash zoom-in                                                     |
| `spotlight-sweep`     | reveal / hold                    | 0.8-2.0s          | spotlight / gradient sweep over text                                      |
| `outline-to-fill`     | downbeat / reveal                | 0.8-1.8s          | stroke outline → solid fill                                               |
| `counting-punch`      | roll → downbeat                  | 1.0-2.5s          | number count-up that punches & locks                                      |
| `particle-burst`      | drop / crash                     | 0.2-1.2s          | particle explosion burst                                                  |
| `radial-burst-lines`  | drop / surge                     | 0.2-0.8s          | radial speed-lines burst                                                  |
| `pixel-dissolve`      | transition / hard_stop           | 0.5-1.5s          | pixelated dissolve                                                        |
| `datamosh-smear`      | glitch / transition              | 0.4-1.2s          | datamosh / motion smear                                                   |
| `text-wave-distort`   | hold / texture                   | 1.0-2.5s          | wavy text distortion                                                      |
| `bg-flow-field`       | energy / whole span (bed)        | 4-12s bed         | generative curl-noise background bed; compose any foreground move over it |
| `blur-resolve`        | stop / final hold                | 0.7-2.0s          | blur-in to crisp focus, then blur-out on the cut                          |
| `chromatic-pressure`  | snare / glitch                   | 0.1-0.5s          | RGB split / digital tension on a transient                                |
| `color-grid-shuffle`  | onset                            | 0ms hits; ≤2s run | grid of cells recolored by a deterministic index per onset                |
| `content-swap`        | beat                             | 0ms hits; ≤3s run | 0ms swap of stacked nodes: the workhorse percussive move                  |
| `directional-fill`    | beat / reveal                    | 0.3-1.0s each     | directional wipe-fill (scaleX) sweeping across bars                       |
| `flash-cut`           | drop / crash                     | 0-0.6s            | full-frame flash masking a word / color state change                      |
| `freeze-hold`         | hard_stop                        | 0ms in; 0.5-2s    | freeze the moving system and hold it                                      |
| `hard-cut`            | beat / hard_stop                 | 0ms in; 0.3-2s    | sample-accurate color-block + word cut                                    |
| `mosaic-pack`         | beat / build                     | 1.5-3.5s          | scattered tiles fly in and pack into a grid                               |
| `negative-space-hold` | silence / hard_stop / final hold | 1-6s hold         | kill busy layers, hold one readable mark in empty space                   |
| `overlay-pop`         | accent                           | 0.2-0.6s in       | badge / lower-third overlay pops in over a base                           |
| `palette-flip`        | section change                   | 0ms flip; 0.5-4s  | same layout re-skins via 0ms palette-variable flips                       |
| `staggered-exit`      | phrase / transition              | 0.4-1.2s          | ordered cascade-out clearing the frame                                    |
| `staggered-reveal`    | build                            | 0.8-2.5s          | ordered cascade-in of a stack / list                                      |
| `system-replace`      | drop / regime change             | 0ms cut           | hard-cut the entire visual system, then boot the new one                  |
| `text-spectral-rays`  | phrase / sweep (hero text)       | 2.5-5s            | volumetric light-rays cast by a wordmark toward a sweeping light cursor   |
| `tile-mosaic`         | build / reveal                   | 1.5-3.5s          | grid of tiles revealed in a diagonal sweep, assembling a poster           |
| `typewriter-reveal`   | roll / build                     | 1.0-3.0s          | character / word type-on with caret                                       |
| `value-counter`       | roll → downbeat                  | 1.0-2.5s          | count-up that locks on a downbeat / hard_stop                             |
| `word-grid-burst`     | onsets → downbeat                | 1.8-3.2s          | grid of words revealed per onset, refocus one on a downbeat               |

## How to combine

- One dominant system per group; layer at most one texture primitive over one structural primitive.
- Structure on strong beats (cuts, camera, `system-replace` → downbeat / phrase / section_start); texture on weak / syncopated hits (`content-swap`, typewriter letters, chromatic accents).
- A roll is an accumulation container — build during it, hard-cut to a clean layout on the downbeat that ends it.
- `drop` ≠ `downbeat`: a downbeat is a cut within the regime; a drop is a regime change (`system-replace`, total clear, element-count jump).
- Let silence remove density (`negative-space-hold`).
- Background beds are a layer, not a move: one bed at a time, under foreground primitives.
- `text-spectral-rays` is the hero wordmark treatment; do not stack another visible copy of the same word on top.
