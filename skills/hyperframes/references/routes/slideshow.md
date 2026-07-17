# Route: slideshow

- **Input:** A brief, outline, or existing page to author as a presentation, pitch deck, or interactive deck. If "slides", "deck", or "convert this page" is ambiguous, confirm that the user wants a HyperFrames slideshow before authoring.
- **Output:** A runnable HyperFrames composition plus the JSON island used by `SlideshowController`: discrete slides, fragment reveals, branching, hotspots, presenter mode, and speaker notes. The deliverable is a navigable deck, not an MP4.
- **Triggers:** "make a pitch deck", "interactive presentation", "convert this page into slides", "slideshow with presenter mode".

## Interview

- The one question is the routing confirmation itself — "do you want this as a HyperFrames slideshow?" — asked during triage (it survives every mode: wrong routing is a quality problem). The deck contract owns everything after.
- **Run-shape:** neither — the deliverable is a navigable deck, not a rendered video.
- **Front-door capability offer:** skip it. After route confirmation, the deck workflow owns all remaining choices.
