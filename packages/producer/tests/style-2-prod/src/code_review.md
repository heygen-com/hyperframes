# HyperFrame Schema Compliance Review

## Executive Summary

- Total files reviewed: 4
- Critical issues: 1
- Overall compliance status: NEEDS_WORK

## Critical Issues

### Top-Level Container Missing Composition ID

- **File**: index.html:59
- **Violation**: The top-level container has `id="main-comp"` but the schema requires `data-composition-id` for all top-level containers.
- **Schema Rule**: "Every top-level HTML container MUST be a composition (i.e., have a `data-composition-id` attribute)."
- **Impact**: The framework will not recognize the root element as a composition, potentially failing to initialize the master timeline or manage its children correctly.

## Compliance Checklist

- [x] All compositions have `data-width` and `data-height` attributes
- [x] All timelines are finite with duration > 0
- [x] All compositions registered in `window.__timelines`
- [x] No use of `Math.random()`, `Date.now()`, or non-deterministic code
- [x] Primitive clips have required data attributes (`id`, `data-start`, `data-track`)
- [x] `data-duration` specified for all `<img>` clips (N/A - no images)
- [x] No manual media playback control (`video.play()`, `audio.pause()`, etc.)
- [x] No manual clip mounting/unmounting in scripts
- [x] Relative timing references are valid (N/A - using absolute timing)
- [x] Clips on same track don't overlap in time
- [x] Reusable compositions in separate HTML files
- [x] Composition files use `<template>` tags
- [x] External compositions loaded via `data-composition-src`
- [x] All script-animated content wrapped in compositions
- [x] No infinite or zero-duration timelines

## File-Specific Reviews

### index.html

**Status**: HAS_ISSUES

**Issues Found**:

1. **Top-Level Composition ID**: Line 59. The root `div` uses `id="main-comp"` but should use `data-composition-id="main-comp"`.
2. **Redundant Duration**: Line 96, 104, 112. Sub-compositions `intro`, `stats`, and `captions` have `data-duration` in `index.html`. While allowed, the schema notes that `data-duration` on the composition element itself (inside the template) is the source of truth.
3. **Track Overlap**: The `aroll` video (Track 1) and `audio-1` in `stats.html` (Track 1) are on the same track number. While they are in different compositions, it's best practice to keep track numbers unique across the project if they represent different layers. However, since they are in different composition scopes, this is technically valid but worth noting.

### compositions/intro.html

**Status**: COMPLIANT

**Issues Found**:

- None. Correctly uses `<template>`, `data-composition-id`, `data-width`, `data-height`, and `data-duration`. Timeline is registered correctly.

### compositions/captions.html

**Status**: COMPLIANT

**Issues Found**:

- None. Correctly handles dynamic content by wrapping it in a composition and using a GSAP timeline for word-level timing.

### compositions/stats.html

**Status**: COMPLIANT

**Issues Found**:

- None. Correctly uses `data-start` and `data-track` for audio primitives and registers the timeline.

## Recommendations

1. **Fix Root Attribute**: Change `id="main-comp"` to `data-composition-id="main-comp"` in `index.html`.
2. **Deterministic Check**: Ensure the `TRANSCRIPT` data remains static and is not generated at runtime using non-deterministic methods (it is currently hardcoded, which is perfect).
