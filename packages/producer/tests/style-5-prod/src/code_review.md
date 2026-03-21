# HyperFrame Schema Compliance Review

## Executive Summary
- Total files reviewed: 5
- Critical issues: 1
- Overall compliance status: NEEDS_WORK

## Critical Issues

### Empty Tween for Duration
- **File**: compositions/captions.html:98
- **Violation**: `tl.to({}, { duration: 2 });`
- **Schema Rule**: "**NEVER create empty tweens** like `tl.to({}, { duration: N })` just to set duration — use `data-duration` instead"
- **Impact**: Violates the declarative timing model. The framework uses `data-duration` to determine the composition's length on the master timeline.

## Compliance Checklist
- [x] All compositions have `data-width` and `data-height` attributes
- [x] All timelines are finite with duration > 0
- [x] All compositions registered in `window.__timelines`
- [x] No use of `Math.random()`, `Date.now()`, or non-deterministic code
- [x] Primitive clips have required data attributes (`id`, `data-start`, `data-track`)
- [x] `data-duration` specified for all `<img>` clips (N/A - no images used)
- [x] No manual media playback control (`video.play()`, `audio.pause()`, etc.)
- [x] No manual clip mounting/unmounting in scripts
- [x] Relative timing references are valid (no circular refs, referenced clips have known duration)
- [x] Clips on same track don't overlap in time
- [x] Reusable compositions in separate HTML files
- [x] Composition files use `<template>` tags
- [x] External compositions loaded via `data-composition-src`
- [x] All script-animated content wrapped in compositions
- [x] No infinite or zero-duration timelines

## File-Specific Reviews

### index.html
**Status**: COMPLIANT
- Correctly uses `data-composition-id`, `data-width`, `data-height`, and `data-duration`.
- Correctly loads sub-compositions using `data-composition-src`.
- Registers `master` timeline in `window.__timelines`.
- **Note**: The `video` element (line 67) uses an absolute `data-start="3"`. This is valid.

### compositions/intro-seq.html
**Status**: COMPLIANT
- Correctly uses `<template>` and `data-composition-id`.
- Dimensions and duration are explicitly set.
- Script is deterministic (uses fixed text and timing).
- Registers `intro-seq` timeline.

### compositions/grid-bg.html
**Status**: COMPLIANT
- Correctly uses `<template>` and `data-composition-id`.
- Dimensions and duration are explicitly set.
- Loops are finite and deterministic.
- Registers `grid-bg` timeline.

### compositions/captions.html
**Status**: HAS_ISSUES
- **Issue**: Line 98 uses an empty tween `tl.to({}, { duration: 2 })` to extend the timeline.
- **Fix**: Remove the empty tween. The duration is already correctly defined in the `data-duration="16.04"` attribute on the root `div` (line 2).
- **Issue**: The `data-duration` is set to `16.04`, but the last caption ends at `16.019`. This is fine as `data-duration` takes precedence.

### compositions/data-graphics.html
**Status**: COMPLIANT
- Correctly uses `<template>` and `data-composition-id`.
- Dimensions and duration are explicitly set.
- Counter animation is deterministic in its logic.
- Registers `data-graphics` timeline.
