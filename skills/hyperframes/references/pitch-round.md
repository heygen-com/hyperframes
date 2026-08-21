# Pitch round — the intent layer's divergent step

Everything else in the intent layer converges: recommended options, receipts, one question per field. This step diverges. An unformed request has nothing to converge on — "make us a video about the launch" answers no creative field, and asking `message` as a form question hands the user the very blank they came to have filled. So before the form, pitch: five concepts, sampled wide, offered once.

## When it runs

Triage (`/hyperframes` → `references/intent-interview.md`, step 2) marks the request formed or unformed; only unformed requests enter the round, and only on routes whose `routes/<workflow>.md` entry names pitch-eligible fields. A recipe adoption skips the round — the bundle already carries an approved concept. An autonomous signal never skips it; it moves the round inside (§ The gate, alone).

Before generating anything, ask what the user is already picturing. An existing idea seeds the round as a pitch of its own and is never displaced by generated ones; a fully formed picture ends the round before it starts — that picture is the concept, and the layer returns to its questions.

## The sampling gate — internal, always

Run this before writing any pitch, in every mode. None of it is shown to the user.

First, four questions about this brief, answered specifically, not generically:

1. **What does the subject look like?** Its own visual world — an island-travel piece has whitewashed walls and caldera cliffs; an outage postmortem has terminal green and a scarred timeline. The subject's vocabulary drives the layouts.
2. **What does the target emotion look like as a frame?** Longing is empty space the viewer wants to fill; urgency is compression; awe is one element too large for the canvas.
3. **What does the playback surface demand?** A lobby screen is ambient and glanced at; a feed fights for its first second; a story is vertical and fast.
4. **What does every other video on this subject look like?** That is the anti-pattern. The tail pitches must not be it.

Then five concepts, one from each path: the subject's world · the emotion · the audience (meet their expectation, or break it) · the anti-pattern, inverted · an unusual format (a letter, a countdown, a recipe, a front page, a map). Estimate for each the probability that a model handed this brief would produce it. The numbers are directional, not calibrated, and they exist to enforce one constraint: **at least two of the five must sit below 0.10.** If all five clear 0.10, every pitch is the median — start over. Then check silhouettes: sketch each concept's major elements as rough bounding boxes; two concepts with the same silhouette are one concept, so replace one.

Probabilities never reach the user. They are a sampling constraint, not a scorecard.

## Presenting the round

Each pitch is three lines: the concept in one sentence, its visual world, its opening hook. The visual-world line carries the machinery: name the one or two capabilities the concept rides, in the plain language of `capability-menu.md`'s middle column — "the launch number counts up on the track's beat grid," never a feature name. This is how the toolbox reaches the user: experienced inside a concept they can want, not listed in a menu they can't evaluate. Machinery earns its mention the way a recommendation earns its place — a capability that would fit all five pitches is decoration; name it only where this concept leans on it.

All five appear before any recommendation — a recommendation stated first anchors everything after it. Then recommend one, with a reason. Mixing is a first-class answer ("the framing of the second with the opening of the fourth"); silence or "you decide" accepts the recommendation. One round: the pitches are an offer, not a quiz, and there is no second batch unless the user asks for one.

The chosen concept **is** the brief's creative core: it answers the route's pitch-eligible fields (typically `message` and `angle`), those questions are skipped downstream with the pitch as their receipt, and the concept lands in `BRIEF.md` under `## Intent` in the wording the user accepted. The capabilities the pitch named are confirmed with it — they land under `## Customizations` and are not re-offered later as if they were new.

## The gate, alone — autonomous runs

"Just build it" changes the audience, not the discipline. Walk the same gate — four questions, five concepts, tail constraint, silhouette check — pick the winner, and keep building. The heads-up then treats the pick like every other receipt-backed decision: name the direction chosen and why, the machinery it rides, and the most typical direction deliberately left behind. An autonomous run is where the median is most dangerous — no one is present to say "this looks like every other video," so the gate has to say it.

## The decision map — "I don't know anything about video"

A user who says they can't judge any of this gets neither pitches nor a question sequence. Give them a map of the two or three decision surfaces where their input genuinely changes the outcome — where it will play, how long it should run, what it should feel like — each with two to four plain-language options and a marked default. They choose only where they can tell the difference; every untouched surface keeps its default with a receipt. Then run the gate autonomous-style and present the winning concept inside the brief summary, where accepting the summary accepts the concept.
