# Characters, mascots and story shorts

A character gives every transition a cause and gives the film its jokes: it carries the result into the player, rejects its own first try, reads the manual. After Effects characters come in through Lottie (`../runtimes.md`).

## Acting

- Mood changes go through a take: anticipation, a squash, the new face, a settle. A face never snaps from one state to the next.
- Squash and stretch, anticipation, overshoot and follow-through belong to the character. Here an idle breath or blink is life, not a tell; the tells about breathing and bounce in `../motion.md` are about titles and UI.
- Code moves every part at once, on one curve, by the same amount. Offset the parts (head leads, arms follow), vary the amounts, and never move both arms, both eyes or a crowd in unison.
- Contact sells it: feet on the ground, props held by the hand, eyes on what they look at.

## Reads

Each action is one read. Lead the eye to where it will happen, play the action fast, and let its meaning land slowly: hold the reaction. A sign or caption that repeats what the action already shows is the classic failure.

## Build

- A rig is a set of parameters over time: position, squash, arm angles, an eye state and a mouth state per moment. Write mood changes as keyed states (`[[t0,"normal"],[t1,"scared"]]`) the rig eases between.
- Hand-drawn life: redraw the outlines about 12 times a second with a jitter seeded by `Math.floor(t * 12)`, so the line boils while the character holds still, and every render matches.
- A long piece is one chapter per sub-composition, all drawing from the same rig and helpers.
