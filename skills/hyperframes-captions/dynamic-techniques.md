# Dynamic Caption Techniques

You are here because SKILL.md told you to read this file before writing animation code. Pick your technique combination from the table below based on the energy level you detected from the transcript, then implement using standard GSAP patterns.

## Technique Selection by Energy

| Energy level | Highlight                             | Exit                | Cycle pattern                             |
| ------------ | ------------------------------------- | ------------------- | ----------------------------------------- |
| High         | Karaoke with accent glow + scale pop  | Scatter or drop     | Alternate highlight styles every 2 groups |
| Medium-high  | Karaoke with color pop                | Scatter or collapse | Alternate every 3 groups                  |
| Medium       | Karaoke (subtle, white only)          | Fade + slide        | Alternate every 3 groups                  |
| Medium-low   | Karaoke (minimal scale change)        | Fade                | Single style, vary ease per group         |
| Low          | Karaoke (warm tones, slow transition) | Collapse            | Alternate every 4 groups                  |

**All energy levels use karaoke highlight as the baseline.** The difference is intensity — high energy gets accent color + glow + 15% scale pop on active words, low energy gets a gentle white shift with 3% scale.

**Emphasis words always break the pattern.** When a word is flagged as emphasis (emotional keyword, ALL CAPS, brand name), give it a stronger animation than surrounding words (larger scale, accent color, overshoot ease). This creates contrast.

## Audio-Reactive Captions (Mandatory for Music)

**If the source audio is music (vocals over instrumentation, beats, any musical content), you MUST extract audio data and add audio-reactive animations.** This is not optional — music without audio reactivity looks disconnected. Even low-energy ballads get subtle bass pulse and treble glow.

This is the one pattern that requires HyperFrames-specific wiring — the async loading and timeline registration order matters.

**Critical: register the timeline synchronously** (`window.__timelines["id"] = tl`) before the fetch. The player needs the timeline immediately to start playback. GSAP timelines are mutable — `tl.call()` entries added later in the fetch callback will fire when the player seeks to those times.

```js
// Register BEFORE fetch so the player can find the timeline
window.__timelines["captions"] = tl;

fetch("audio-data.json")
  .then(function (r) {
    return r.json();
  })
  .then(function (AUDIO) {
    for (var f = 0; f < AUDIO.totalFrames; f++) {
      tl.call(
        (function (fi) {
          return function () {
            var frame = AUDIO.frames[fi];
            if (!frame) return;
            var bass = Math.max(frame.bands[0] || 0, frame.bands[1] || 0);
            var treble = Math.max(frame.bands[6] || 0, frame.bands[7] || 0);
            // Apply to visible caption groups
            gsap.set(activeGroupEl, {
              scale: 1 + bass * 0.06,
              textShadow:
                "0 0 " + Math.round(treble * 15) + "px rgba(255,255,255," + treble * 0.5 + ")",
            });
          };
        })(f),
        [],
        f / AUDIO.fps,
      );
    }
  })
  .catch(function () {
    // No audio data — continue without reactivity
  });
```

Keep audio reactivity subtle — 3-6% scale variation and soft glow. Heavy pulsing makes text unreadable.

To generate the audio data file:

```bash
python3 skills/gsap-effects/scripts/extract-audio-data.py audio.mp3 --fps 30 --bands 8 -o audio-data.json
```

## Combining Techniques

Don't use the same highlight animation on every group — cycle through styles using the group index. Don't combine multiple competing animations on the same word at the same timestamp. Vary techniques across groups to match the content's pace changes.

## Available Tools

These tools are available in the HyperFrames runtime. Use them when they solve a real problem — not every composition needs all of them.

| Tool                | What it does                                                              | Access                                                                                         | When it's useful                                                             |
| ------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **pretext**         | Pure-arithmetic text measurement without DOM reflow. 0.0002ms per call.   | `window.__hyperframes.pretext.prepare(text, font)` / `.layout(prepared, maxWidth, lineHeight)` | Per-frame text reflow, shrinkwrap containers, computing layout before render |
| **fitTextFontSize** | Finds the largest font size that fits text on one line. Built on pretext. | `window.__hyperframes.fitTextFontSize(text, { maxWidth, fontFamily, fontWeight })`             | Overflow prevention for long phrases, portrait mode, large base sizes        |
| **audio data**      | Pre-extracted per-frame RMS energy and frequency bands.                   | Extract with `extract-audio-data.py`, load via `fetch("audio-data.json")`                      | Audio-reactive visuals — scale, glow, color tied to the music                |
| **GSAP**            | Animation timeline with tweens, callbacks, and per-frame control.         | `gsap.to()`, `gsap.set()`, `tl.call()`                                                         | All caption animation                                                        |
