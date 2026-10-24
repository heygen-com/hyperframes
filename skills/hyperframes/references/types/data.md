# Numbers, charts and data stories

## One number at a time

- A number is earned by the scene before it, then made physical: a count that becomes a skyline, a share that becomes a crowd.
- The number is the biggest thing on screen. Tabular figures (`font-variant-numeric: tabular-nums`) so a count-up does not jitter; a count-up runs 1.2–1.6 s, then holds.
- Real data only, from the source, rounded the same way everywhere, with a small source line on screen. One data module drives every figure in the film.

## Charts as pictures

- Build a chart in reading order: the frame and axis, a reference line, then the data drawing in, then one annotation on the point that matters. Annotate on the mark; no legends.
- Highlight one series, grey the rest. A chart with one thing to say says it in its title.
- The same object carries across beats: a bar becomes the ground of the next scene, a line becomes the road the camera follows.
- The camera can dive into the one value that matters, then the rest falls away.
- Registry charts first (`npx hyperframes catalog --query chart --json`); drive any chart library from a GSAP tween's `onUpdate`, never its own transitions (`../runtimes.md`).

## Tells for this type

A grid of KPI cards; a dashboard; a pie chart; every number counting up at once; numbers with no source.
