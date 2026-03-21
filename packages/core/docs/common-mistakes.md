# Common Mistakes

Pitfalls that break HyperFrames compositions that can't be caught by the linter.

> **Linter:** Run `lintHyperframeHtml()` on your composition to catch most issues automatically. The linter detects: missing timeline registration, unmuted video, nested video in timed elements, missing `class="clip"`, deprecated attribute names (`data-layer`, `data-end`), and missing dimensions. See `core/src/lint/` for the full rule list.

---

## 1. Animating video element dimensions with GSAP

**Symptom:** Video frames stop updating, or browser performance drops.

**Cause:** GSAP animating `width`, `height`, `top`, `left` directly on a `<video>` element can cause the browser to stop rendering frames.

```js
// BROKEN — animating video element dimensions
tl.to("#el-video", { width: 500, height: 280, top: 700, left: 1400 }, 26);

// FIXED — animate a wrapper div, video fills it at 100%
tl.to("#pip-wrapper", { width: 500, height: 280, top: 700, left: 1400 }, 26);
```

Use a non-timed wrapper div for visual effects like picture-in-picture. Animate the wrapper; let the video fill it.

---

## 2. Controlling media playback in scripts

**Symptom:** Audio/video playback is out of sync, or plays when it shouldn't.

**Cause:** Calling `video.play()`, `video.pause()`, `audio.currentTime = ...` in your scripts. The framework owns all media playback.

```js
// BROKEN — conflicts with framework media sync
document.getElementById("el-video").play();
document.getElementById("el-audio").currentTime = 5;

// FIXED — don't do this. The framework handles it.
// Use GSAP for visual animations only:
tl.to("#el-video", { opacity: 1, duration: 0.5 }, 0);
```

---

## 3. Composition duration shorter than video

**Symptom:** Video plays for a few seconds then stops. Timeline shows 8-10 seconds even though the video is minutes long.

**Cause:** The composition duration equals the GSAP timeline duration, not `data-duration` on the video. If your last GSAP animation ends at 8 seconds, the composition is 8 seconds long.

```js
// BROKEN — timeline is only 8s long, video cuts off
tl.to("#lower-third", { left: -640, duration: 0.6 }, 7.2);
// Last tween ends at 7.8s → composition = 7.8s

// FIXED — extend timeline to match video length
tl.to("#lower-third", { left: -640, duration: 0.6 }, 7.2);
tl.set({}, {}, 283); // ← extends timeline to 283 seconds
```

`tl.set({}, {}, TIME)` adds a zero-duration tween at the specified time, which extends the timeline without affecting any elements.

---

## Debugging checklist

When something doesn't work, check in this order:

1. Run the linter: `lintHyperframeHtml(html)` — catches most structural issues
2. Is `window.__timelines["<id>"]` registered? Does the key match `data-composition-id`?
3. Are GSAP animations only on visual properties (opacity, transform, color)?
4. Is the GSAP timeline long enough? (`tl.set({}, {}, DURATION)` at the end)
5. Open browser console — runtime errors show up as `[Browser:ERROR]` or `[Browser:PAGEERROR]`
