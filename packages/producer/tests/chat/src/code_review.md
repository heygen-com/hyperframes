# HyperFrame Schema Compliance Review

## Executive Summary
- Total files reviewed: 2
- Critical issues: 1
- Overall compliance status: NEEDS_WORK

## Critical Issues

### Empty Tweens for Duration
- **File**: index.html:26
- **File**: compositions/typography.html:224
- **Violation**: `masterTL.to({}, { duration: 15 });` and `tl.to({}, { duration: 15 });`
- **Schema Rule**: "NEVER create empty tweens like `tl.to({}, { duration: N })` just to set duration — use `data-duration` instead"
- **Impact**: This is a direct violation of the schema's duration management rules. While it might work in some environments, it bypasses the framework's declarative duration system and can lead to rendering inconsistencies or failures in the server-side renderer.

## Compliance Checklist
- [x] All compositions have `data-width` and `data-height` attributes
- [x] All timelines are finite with duration > 0
- [x] All compositions registered in `window.__timelines`
- [x] No use of `Math.random()`, `Date.now()`, or non-deterministic code
- [x] Primitive clips have required data attributes (`id`, `data-start`, `data-track-index`)
- [x] `data-duration` specified for all `<img>` clips (N/A - no images)
- [x] No manual media playback control (`video.play()`, `audio.pause()`, etc.)
- [x] No manual clip mounting/unmounting in scripts
- [x] Relative timing references are valid (N/A - no relative timing used)
- [x] Clips on same track don't overlap in time
- [x] Reusable compositions in separate HTML files
- [x] Composition files use `<template>` tags
- [x] External compositions loaded via `data-composition-src`
- [x] All script-animated content wrapped in compositions
- [x] No infinite or zero-duration timelines

### index.html
**Status**: HAS_ISSUES

**Issues Found**:
- **Line 26**: Uses empty tween `masterTL.to({}, { duration: 15 });` to set duration. Should use `data-duration="15"` on the `#main` div (line 11) instead.

### compositions/typography.html
**Status**: HAS_ISSUES

**Issues Found**:
- **Line 224**: Uses empty tween `tl.to({}, { duration: 15 });` to set duration. Should use `data-duration="15"` on the composition root div (line 2) instead.
- **Line 156**: `const sceneEl = document.querySelector(scene.id);` - While not a strict violation, it's better to scope queries to the composition root to avoid conflicts if multiple instances of the same composition are loaded.

## Recommended Fixes

### Fix 1: Declarative Duration in index.html
Replace the empty tween with `data-duration` on the element.

```html
<!-- Change line 11 -->
<div id="main" data-composition-id="main-comp" data-width="1080" data-height="1920" data-start="0" data-duration="15">

<!-- Remove line 26 -->
<!-- masterTL.to({}, { duration: 15 }); -->
```

### Fix 2: Declarative Duration in typography.html
Replace the empty tween with `data-duration` on the element.

```html
<!-- Change line 2 -->
<div data-composition-id="typography" data-width="1080" data-height="1920" data-duration="15">

<!-- Remove line 224 -->
<!-- tl.to({}, { duration: 15 }); -->
```
