# echo-smear

A streak that follows speed. As an element moves faster, more time-offset copies of it trail behind;
when it slows below a threshold they vanish. It is After Effects' Echo effect (Maximum operator) with
the copy count and spacing driven by the element's own motion, so you animate the element and the smear
follows without keyframes of its own.

`attachEchoSmear(targets, timeline, options)` records each target's real trajectory (position, rotation,
scale, opacity) once, with a forward sweep of the timeline, then draws the copies from that record. The
frame at time `t` is the same however you reach it: seeking, scrubbing and parallel render workers agree.

## Mounting

Paste `echo-smear.html` into the composition, define every tween, then attach before registering the
timeline:

```js
attachEchoSmear(".card", tl, { length: 100, threshold: 40 });
```

Targets are anything GSAP moves with a transform (not an element inside an `<svg>`; attach to the
`<svg>`). The header comment in the snippet documents every option and the limits.

## Demo

`demo.html` shows a logo skimming under a word and kicking each letter up, then spiralling away. Letters
and logo both smear, and the spiral shows the streak following a curve.
